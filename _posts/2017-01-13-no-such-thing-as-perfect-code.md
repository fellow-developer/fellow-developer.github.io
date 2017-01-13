---
layout: post
title: No such thing as perfect code
date: 2017-01-13 17:00
categories: dotnet rawrabbit
---

The date for the next major release of [RawRabbit](https://github.com/pardahlman/RawRabbit) is drawing nearer. It is more than a year ago since I decided to implement a [.NET Core](https://dot.net/core)[^1] client for [RabbitMq](https://www.rabbitmq.com/). During this time, I've discovered some differences between developing a library and an application.

## Application code is your code

Applications are often created with a clear purpose and one or a few well defined user cases. There is often no sleep lost over how a repository is wired up or exactly when the connection to the database is established. Bugs can be identified and patched within the development cycle without any external dependencies.

There are of course exceptions to this, but I think most of you can partly agree or think of an application you've worked on where this is true.

## Library code is everyone else's

_Application uses libraries_ to do things for them. They rely on the library to work for scenarios defined long after the library is shipped.

A bug in an third party library can have devastating consequences for a project. I know times when I've looked through the source code of open source projects, trying to figure out what's going on - instead of making progress on the project I'm on.

> Bugs are not the only thing that can slow you down. Assumptions made when creating a library can be just as problematic.

Bugs are not the only thing that can slow you down. Assumptions made when creating a library can be just as problematic. Here's an example. If you want to [publish or consume](https://www.rabbitmq.com/tutorials/tutorial-three-dotnet.html) a message over RabbitMq, you need a connection. RawRabbit tries to establish a connection when it is instantiated, so that it can verify that the provided configuration is correct. This means that if something goes wrong the client can throw a clear exception _right when the application starts up_, which in turn can be used to indicate that something went wrong with a deployment.

Makes sense, right? Well, it turns out that there are scenarios[^2] where it makes sense to delay the connection or add some sort of retry policy. [Controlled consume concurrency]({% post_url 2017-01-05-controlled-concurrency %}) is another example of something that was not supported, but important at times.

I didn't foresee that, how can this be handled?

## Dependency Injection is not enough

RawRabbit, like other libs, offers a way to [register internal services](https://github.com/pardahlman/RawRabbit/blob/stable/sample/RawRabbit.AspNet.Sample/Startup.cs#L32-L41) that will be used for the client

```csharp
public void ConfigureServices(IServiceCollection services)
{
  services
    .AddRawRabbit(
      ioc => ioc
        .AddSingleton(LoggingFactory.ApplicationLogger)
        .AddSingleton<IInternalService, CustomService>())
    .AddMvc();
}
```
That's great for scenarios like the one I described. The problem can be solved by register a home rolled `IChannelFactory`. However, a realistic scenario is that a custom implementation of an internal service is a copy of the default implementation together with a relative small portion of custom code. The custom implementations becomes a snapshot of the default implementation. It is time consuming to keep a custom implementation aligned with latest defaults. It is even easier to forget to update it, or make mistakes when working with internal aspects that might be unfamiliar to the developer.

## Expect the unexpected

I realized that there is no way to predict all the user cases for a client like RawRabbit. Instead, I've tried to ensure that it is easy to customize the behavior if needed. Here are some details of how I did this.

### Optional options and reasonable defaults

RawRabbit's uses a [middleware architecture]({% post_url 2016-12-25-one-method-to-rule-them-all %}), where each middleware has a corresponding options class. A middleware like `BasicPublishMiddleware` has an optional constructor argument `BasicPublishOptions`. All options classes follow the same pattern and looks something like this

```csharp
public class BasicPublishOptions
{
  public Func<IPipeContext, string> RoutingKeyFunc { get; set; }
  public Func<IPipeContext, IModel> ChannelFunc { get; set; }
  public Func<IPipeContext, string> ExchangeNameFunc { get; set; }
  public Func<IPipeContext, bool> MandatoryFunc { get; set; }
  public Func<IPipeContext, IBasicProperties> BasicPropsFunc { get; set; }
  public Func<IPipeContext, byte[]> BodyFunc { get; set; }
}
```

Each func reflects some aspect of the middleware. The routing key, for example, will be retrieved by calling the `RoutingKeyFunc`[^3]. This allows the caller to slightly change the behavior of the middleware by supplying different options. The client leverage this when [performing an RPC request](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit.Operations.Request/RequestExtension.cs#L53-L58).

```csharp
.Use<BasicPublishMiddleware>(new BasicPublishOptions
{
    ExchangeNameFunc = c => c.GetRequestConfiguration()?.Request.Exchange.Name,
    RoutingKeyFunc = c => c.GetRequestConfiguration()?.Request.RoutingKey,
    ChannelFunc = c => c.Get<IBasicConsumer>(PipeKey.Consumer)?.Model
})
```
The funcs are assigned to fields when constructing the middleware. If no value is provided, the func will fallback to ["reasonable" defaults](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/BasicPublishMiddleware.cs#L34-L39).

### Virtual protected methods

The funcs from the options object are not called in (the main method) `InvokeAsync`. Each func is instead invoked in a separate method that is marked `protected virtual`. The actual code for [retrieving the routing key](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/BasicPublishMiddleware.cs#L94-L102) looks like this

```csharp
protected virtual string GetRoutingKey(IPipeContext context)
{
  var routingKey =  RoutingKeyFunc(context);
  if (routingKey == null)
  {
    _logger.LogWarning("No routing key found in the Pipe context.");
  }
  return routingKey;
}
```
If necessary, a custom implementation can be created by inheriting from the middleware and override relevant methods. It might be overkill for something like the routing key, but might be very useful for things like channel management.

Splitting everything up into really small methods also has a nice side effect, the code get really easy to follow

```csharp
public override Task InvokeAsync(IPipeContext context, CancellationToken token)
{
  var channel = GetOrCreateChannel(context);
  var exchangeName = GetExchangeName(context);
  var routingKey = GetRoutingKey(context);
  var mandatory = GetMandatoryOptions(context);
  var basicProps = GetBasicProps(context);
  var body = GetMessageBody(context);

  ExclusiveExecute(channel, c => c.BasicPublish(
    exchange: exchangeName,
    routingKey: routingKey,
    mandatory: mandatory,
    basicProperties: basicProps,
    body: body
  ), token);

  return Next.InvokeAsync(context, token);
}
```

### Make it easy to tweak

It is even possible to remove or replace certain middlewares of an existing pipe. That means that a custom middleware can be registered in an predefined pipe, like the pipe used for publishing

```csharp
var customPipe = PublishMessageExtension.PublishPipeAction + (pipe => pipe
  .Replace<BasicPublishMiddleware, CustomPublishMiddleware>();
```
The code above creates a custom pipe that is identical to the [official publish pipe](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit.Operations.Publish/PublishMessageExtension.cs#L15), that will be kept updated together with the lib.


#### Footnotes

[^1]: I _really_ wonder how much Microsoft payed for that domain.
[^2]: Like working with containers, as described in [this issue](https://github.com/pardahlman/RawRabbit/issues/132)
[^3]: With the provided `IPipeContext` from the [middleware base class](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/Middleware.cs#L10)
