---
title: A truly event driven web
authors: pardahlman
tags: [dotnet, rawrabbit]
---

Ever been to one of those aggregating search sites where the result list is populated in chunks, rather than all at once? Ever wondered how it works? Event driven sites are robust, extendable - and if you're on a messaging system like [RabbitMQ](https://www.rabbitmq.com/) and a .NET client like [RawRabbit](https://github.com/pardahlman/RawRabbit), it is pretty easy to get started.

<!-- truncate -->

## Event driven what?

Traditional sites have always been constrained by the limitation of request/respond. Interaction with server side is _always_ initialized from the client. An incoming request is the only way for a back-end to communicate with the client. That communication is also limited by the fact that a response will only be sent to the client that sent the request. These two properties combined makes it impossible for the back-end to reach out to a passive client.

[WebSockets](https://en.wikipedia.org/wiki/WebSocket) was introduced back in 2011 and gave us the possibility for communication initiated at server side. All of a sudden, the server could push messages to a client - or broadcast to many client at the same time. This technology has been revolutionary to sites selling tickets and holding real time auctions.

It also improved the life for those of us not working in these markets. More concretely it gave us the possibility to directly acknowledge an incoming request with a `202 Accepted`[^1], process the request in an asynchronous fashion and get back to the caller through web sockets.

## What's wrong with the old ways?

It is nothing wrong with a synchronous handling of http requests.

The problem with processing requests in a blocking way _in a message oriented solution_ is that it forces other parts of the application to act blocking too. Take a look at this request handler in a `ApiController`

```csharp
[HttpGet]
[Route("api/todos/{id}")]
public async Task<IActionResult> GetTodo(int id)
{
  // ouch - blocking call!
  var result = await busClient.RequestAsync<TodoRequest, TodoResponse>(
    new TodoRequest {Id = id}
  );

  if (result.Todo == null)
  {
    return NotFound();
  }
  return Ok(response.Todo);
}
```

In this example, the incoming request is handled by [RawRabbit's BusClient](https://github.com/pardahlman/RawRabbit), that makes an RPC call to some other system that will process the request. However, `RequestAsync` is a blocking call, demanding the responding service to produce the actual response before continuing. In this example, it would be when a service that consumes the request publishes a response

```csharp
await busClient.RespondAsync<TodoRequest, TodoResponse>(async req =>
{
  var todo = await repo.GetAsync(req.Id);
  return new TodoResponse { Todo = todo };
});

```

### Not really loose coupled

If the application that handles `TodoRequests` had to communicate with other applications in order to complete the request, it had to do so in a blocking way as well.

The logical code execution becomes sequential, from the controller, to the responding service, and then back to the controller. It's almost like the code within the message handler could be copied into the controller, right?

> When an application relies on blocking calls to other applications, it has formed dependencies to them that is just as strong as if they would have been running in the same process.

An process in application A will fail if it expects a response from application B, that in turn waits for a response application C that is currently unavailable.

## Fire and forget, captain

I've already hinted about it: _there are other options_! It takes a leap of faith, since what you are doing is starting a process, and without knowing how it will evolve, you return and say that things are on its way.

```csharp
[HttpPost]
[Route("api/todos")]
public async Task<IActionResult> CreateTodo(Shared.Todo todo)
{
  await BusClient.PublishAsync(new CreateTodo {Todo = todo});
  return Ok(new {success = true});
}
```

Just as before, there is a service that consumes the message. Unlike before, the http response is returned right away, containing only an acknowledgment. This also means that there is no caller waiting for the process to produce its result. Instead the application publishes a new message informing that the todo is created.

```csharp
await BusClient.SubscribeAsync<CreateTodo>(async msg =>
{
  if (msg.Todo == null)
  {
    return new Nack(false);
  }
  var created = await repo.AddAsync(msg.Todo);
  await busClient.PublishAsync(new TodoCreated
  {
    Todo = created
  });
  return new Ack();
});
```

### Multiple applications listening in

One of the really powerful concepts with this approach is that the `TodoCreated` message can be consumed by other applications as well. Say for example that a user has signed up for email updates when a todo is created. That service would listen to that message without being explicitly requested to. If, in a later stage, a service is developed that consumes the message to create elaborate reports, it can be developed an deployed without touching the existing applications.

### Getting back to the caller

On of the (potentially many) applications that are interested in the created todo is the web API where it all begun. The browsers needs to be informed that a todo is created. The API holds WebSockets connections to the browsers, something that in the .NET world usually means [SignalR](https://www.asp.net/signalr). More concretely, the web project registers a subscriber that is invoked when the todo is created. It uses the [Connection Manager](https://msdn.microsoft.com/en-us/library/microsoft.aspnet.signalr.infrastructure.iconnectionmanager(v=vs.118).aspx) to get reference to the clients and invoke a callback method on them.

```csharp
await BusClient.SubscribeAsync<TodoCreated, TodoContext>((created, context) =>
{
  _connectionMgmt.GetHubContext<TodoHub>().Clients.All.onTodoCreated(created.Todo);
  return Task.CompletedTask;
});
```

## Sending response to caller only

In the example above, we invoked all connected clients - that is, all browsers on our site. That is actually pretty useful in many cases. Sometimes, however, it makes more sense to only act on the caller. In order to do so, we need to create an identifier for the caller and passed around in the execution.

### Deciding on identifier

The identifier should consistent through-out the user's session and accessible upon every request. I think you've guessed it: we're saving the session id in a cookie.

Setting the cookie value can be done in may places in the application. I tend to write a small OWIN middleware that checks if the cookie is set and if not, just sets it.

### Register client in SignalR

Next we need to map the client id to a SignalR connection id. This is done by creating [single user groups](https://docs.microsoft.com/en-us/aspnet/signalr/overview/guide-to-the-api/mapping-users-to-connections#single-user-groups) `OnConnected` in the Hub.

```csharp
public override Task OnConnected()
{
  string cookie;
  if (Context.Request.Cookies.TryGetValue(Constants.SessionCookie, out cookie))
  {
    Groups.Add(Context.ConnectionId, cookie);
  }
  return base.OnConnected();
}
```

### Create message context with session id

The session id is a prime candidate to be passed in the [message context](https://github.com/pardahlman/RawRabbit/blob/2.0/docs/enrichers/message-context.md) on any outgoing messages from the API. It can be passed explicitly in each message, but I think the code gets cleaner if the message context is registered when registering the client itself.

```csharp
services.AddRawRabbit(new RawRabbitOptions
{
  Plugins = p => p
    .UseHttpContext()
    .UseMessageContext(ctx => new TodoContext
    {
      Source = ctx.GetHttpContext().Request.GetDisplayUrl(),
      ExecutionId = ctx.GetGlobalExecutionId(),
      SessionId = ctx.GetHttpContext().Request.Cookies[Constants.SessionCookie]
    })
});
```

### Implicit context forwarding

A neat feature in RawRabbit is the implicit context forwarding, that passes any received context to any outgoing message. It is also a plugin that is available when using the message context enricher.

```csharp
var busClient = RawRabbitFactory.CreateSingleton(new RawRabbitOptions
{
  Plugins = p => p
    .UseContextForwarding()
    .UseMessageContext<TodoContext>()
});
```

No matter how many services that are involved in the execution of the request, the message context will be passed along as long as context forwarding is used.

### Putting it all together

That's it! Any message from the web API will be published with a message context that contains the session id. The context will be forwarded throughout the execution chain. Once back in the web API, the connection manager can use the session id to find the calling party and invoke client side methods based on that.

```csharp
await _busClient.SubscribeAsync<TodoCreated, TodoContext>(async (created, context) =>
{
  _connectionMgmt
    .GetHubContext<TodoHub>()
    .Clients // all connected clients
    .Group(context.SessionId) // caller
    .onTodoCreated(created.Todo);
});
```

### Try it out yourself

Most of the code examples here comes from a [example project](https://github.com/pardahlman/RawRabbit.Todo) at Github. Clone it and play around with it as much as you like.

Happy coding!


#### Footnotes
[^1]: From the [RFC](https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html): _The request has been accepted for processing, but the processing has not been completed. The request might or might not eventually be acted upon, as it might be disallowed when processing actually takes place._
