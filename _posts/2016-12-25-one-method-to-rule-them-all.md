---
layout: post
title: One method to rule them all
date: 2016-12-25 11:45
categories: dotnet rawrabbit
---
I wasn't thrilled when [Owin](http://owin.org/) was introduced back in 2012. Sure, I could see the benefits in an abstraction layer between the web server and the application, but I didn't really see the full potential of the ecosystem of [middlewares](https://msdn.microsoft.com/en-us/library/microsoft.owin.owinmiddleware(v=vs.113).aspx) that came about a few months later. Then, for a long time, my only relation to these middleware was through extension methods like

```csharp
public void Configuration(IAppBuilder app)
{
    app.UseFoo();
    app.UseBar();
}
```

## Home rolled Middleware

However, as I planed for the next major release of [RawRabbit](https://github.com/pardahlman/RawRabbit), I had come to appreciate the modularization that middleware provides, and decided to implement a middleware pipeline, realized in a class with one single method. Time and time again I got surprised how powerful this one method is. Say hello to `InvokeAsync` on the base class `Middleware`[^1]

```csharp
public abstract class Middleware
{
  public abstract Task InvokeAsync(IPipeContext context, CancellationToken token);
}
```
`IPipeContext` holds a `Dictionary<string,object>` that is being built up by middleware throughout the execution pipe. Just as with other middleware pipes, it is up to the current middleware to invoke the next middleware.

### Sequential Execution
If the call to invoke the next middleware is the last thing that happens in the middleware, the execution becomes _sequential_, meaning that subsequent middlewares will be executed after the current one. This is useful when, for example, adding entries to the context for later use. A key resource in RabbitMq is the channel (`IModel`) that is used for both consuming and publishing messages. Channels are not threadsafe, which adds to the complexity in a fully async library.

```csharp
public override Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  var channel = CreateChannel();
  context.Properties.Add("channel", channel);
  return Next.InvokeAsync(context);
}
```

### Callback execution
Sometimes it can be useful to execute some code after the subsequent pipe is executed. Example of this is disposing/cleaning up objects from the context, releasing exclusive locks or just log execution time

```csharp
public override async Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  var stopwatch = StopWatch.StartNew();
  await Next.InvokeAsync(context);
  stopwatch.Stop();
  context.Properties.Add("execution_time", stopwatch.ElapsedTicks);
}
```

### Conditional execution
If a middleware doesn't call next, the execution ends and the chain of tasks starts to complete. As I wrote code to honor the cancellation token and it's states I found myself in a position where I needed to decide if it was up to each middleware to check if cancellation has been requested or if a check would be injected in between each declared middleware. I sided on the latter, and created the [`CancellationMiddleware`](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/CancellationMiddleware.cs), that aborts the execution if requested

```csharp
public override Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  if (token.IsCancellationRequested)
  {
    return TaskUtil.FromCancelled();
  }
  return Next.InvokeAsync(context, token);
}
```

### End of pipe
The execution ends when a middleware executes without calling next. `RawRabbit`'s pipe builder appends a [no operation middleware](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/NoOpMiddleware.cs) at the end of the declared pipe

```csharp
public override Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  return Task.FromResult(0);
}
```

## Declare and execute pipes
A bunch or middleware, wonderful! How do we go about to execute them? For RawRabbit, as the `IBusClient` interface is the entry point to the lib, it felt natural to add it there. It turns out that there are only two things needed to allow the pipe to be as dynamic as possible, an `Action<IPipeBuilder>` (very much similar to the `IAppBuilder` we know from .NET Core) and an `Action<IPipeContext>` to set initial values of the pipe context. This is an example of how you would perform a basic publish with the 2.0 client

```csharp
client.InvokeAsync(
  pipe => pipe
    .Use<PublisherConfigurationMiddleware>()
    .Use<ExchangeDeclareMiddleware>()
    .Use<BodySerializationMiddleware>()
    .Use<BasicPropertiesMiddleware>()
    .Use<TransientChannelMiddleware>()
    .Use<MandatoryCallbackMiddleware>()
    .Use<PublishAcknowledgeMiddleware>()
    .Use<BasicPublishMiddleware>(),
  ctx => ctx.Properties.Add(PipeKey.Message, message),
  cancellationToken);
```


### Enriching the client with extension methods

### Stage markers

`Owin` uses [stage markers](https://www.asp.net/aspnet/overview/owin-and-katana/owin-middleware-in-the-iis-integrated-pipeline) to indicate where

[^1]: [Full implementation](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/Middleware.cs) also contains the `Next` method for easier building of pipes. More about that later.
