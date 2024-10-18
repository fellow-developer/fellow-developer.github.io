---
title: One method to rule them all
authors: pardahlman
tags: [dotnet, rawrabbit]
---

I wasn't thrilled when [Owin](http://owin.org/) was introduced back in 2012. Sure, I could see the benefits in an abstraction layer between the web server and the application, but I didn't really see the full potential of the ecosystem of [middlewares](https://msdn.microsoft.com/en-us/library/microsoft.owin.owinmiddleware(v=vs.113).aspx) that came about a few months later. Then, for a long time, my only relation to these middleware was through extension methods like

```csharp
public void Configuration(IAppBuilder app)
{
    app.UseFoo();
    app.UseBar();
}
```

<!-- truncate -->

Fast-forward to 2016, and things have change. Not only Owin, but the entire [.NET Core](https://dot.net/core) application platform uses this approach to extend and customize applications.

As I planed for the next major release of [RawRabbit](https://github.com/pardahlman/RawRabbit), I had come to appreciate the modularization that middleware provides, and decided to implement a middleware pipeline, realized in a class with one single method. Time and time again I got surprised how powerful this one method is. Without further ado: say hello to `InvokeAsync` on the base class `Middleware`[^1]

```csharp
public abstract class Middleware
{
  public abstract Task InvokeAsync(IPipeContext context, CancellationToken token);
}
```
`IPipeContext` holds a `Dictionary<string,object>` that is being built up by middleware throughout the execution pipe. Just as with other middleware pipes, it is up to a middleware to invoke the next middleware. Depending on where the call is made, you get different behaviors.

### Sequential Execution
If the call to invoke the next middleware is the last thing that happens in the middleware, the execution becomes _sequential_, meaning that subsequent middlewares will be executed after the current one. This is useful when, for example, adding entries to the context for later use. A key resource in RabbitMq is the channel (`IModel`) that is used for both consuming and publishing messages.

```csharp
public override Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  var channel = CreateChannel();
  context.Properties.Add("channel", channel);
  return Next.InvokeAsync(context);
}
```

### Callback execution
Sometimes it can be useful to execute some code after the subsequent pipe is executed. Example of this is disposing/cleaning up objects from the context, releasing exclusive locks or just logging execution time

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
This deterministically ends the execution and starts returning completed tasks.

### Declare and execute pipes
A bunch or middleware, wonderful! How do we go about to execute them? For RawRabbit, as the `IBusClient` interface is the entry point to the lib, it felt natural to add it there. It turns out that there are only two things needed to allow the pipe to be as dynamic as possible:

  * `Action<IPipeBuilder>` (very similar to the `IAppBuilder` we all know and love from .NET Core), that provides a fluid interface to declare the pipes.
  * `Action<IPipeContext>` to set initial values of the pipe context.

This is an example of how you would perform a basic publish with the 2.0 client[^2]

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
  ctx => {
    ctx.Properties.Add(PipeKey.Message, message);
    ctx.Properties.Add(PipeKey.ConfigurationAction, config);
    },
  cancellationToken);
```
Pretty neat, huh? Each middleware has a clear purpose and none of them have more than 100 lines of code. When the classes are small and specific it is easy to get an overview over the steps in the process.

### Simplifying execution with extension methods
It just isn't feasible to have a multiline, complex expression just to perform a simple publish (or any other operation for that matter). This is where extension methods comes to the rescue. It turns out that it is dead simple to create a publish signature that very much resembles the 1.x way of doing things.

```csharp
client.PublishAsync(message, cfg => cfg
    .OnExchange("custom_exchange")
    .WithRoutingKey("custom_key")
);
```
In fact, if you look at the two latest code snippets, You can probably map the arguments to the context actions.

More importantly, it creates a separation between executing the pipe and specialized operations. All methods that existed on `IBusClient` interface (pub/sub and RPC) have been moved out to separate NuGet packages. No operation has privileged access to bus client internals. This ensures that it is easy to create new extension methods or implementations of operations.

> No operation has privileged access to bus client internals. This ensures that it is easy to create new extension methods or implementations of operations.

The next version of [RawRabbit](https://github.com/pardahlman/RawRabbit/) (2.0), is well on it's way. For more information about the progress, checkout the [issues labeled 2.0](https://github.com/pardahlman/RawRabbit/issues?q=is%3Aopen+is%3Aissue+label%3A2.0) for the latest status.

#### Footnotes

[^1]: [Full implementation](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/Middleware.cs) also contains the `Next` method for easier building of pipes. More about that later.
[^2]: The full implementation of `PublishAsync` in RawRabbit contains more options and a larger pipe. These are removed for clarity.
