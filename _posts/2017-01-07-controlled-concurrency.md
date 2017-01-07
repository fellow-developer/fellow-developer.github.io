---
layout: post
title: Controlled concurrency
date: 2017-01-05 07:25
categories: dotnet rawrabbit
---
A few days ago, [I asked](https://groups.google.com/forum/#!topic/rabbitmq-users/7CgIDoXGMQU) the RabbitMq community for input on what is missing in todays high level .NET clients. One of the topics that came up was the ability to control the concurrency of messages consumed. This has been [discussed before](https://github.com/pardahlman/RawRabbit/issues/144), so I thought I'd implement it for [RawRabbit](https://github.com/pardahlman/RawRabbit/).

A common reason for wanting to throttle the number of concurrent messages handled is that a high message rate may affect the overall prestandard of the system. If the throughput is in the range of thousands messages per second, and each message involves one or more database read/writes it can easely put unnecessary pressure on the system.

## The right tool for the job

There are a few different approaches to manage concurrency, but besides home rolled locking solutions and  "limited" task factory with custom [task schedulers](https://msdn.microsoft.com/en-us/library/ee789351(v=vs.100).aspx) there is only one viable option, semaphores. For my purposes the `SemaphoreSlim` was more than enough.

```csharp
    var semaphore = new SemaphoreSlim(1,1);
    await semaphore.WaitAsync();
    /* entered */
    semaphore.Release();
```

There are two features of the `SemaphoreSlim` that I want to highlight. The first is that it allows for task based execution. Ever tried to use the `async` keyword in a `lock` statements? Your code wouldn't compile, as it is [simply not allowed](https://msdn.microsoft.com/en-us/library/hh156528.aspx)[^1]. There is no compile time error when using `Monitor.Enter(obj)` together with tasks, but you get a runtime error if you try to exit on a different thread (which isn't surprising since they are [precisely equivalent](https://msdn.microsoft.com/en-us/library/aa664735(v=vs.71).aspx).)

Secondly, semaphores are not exclusive lock mechanisms. The constructor declares the initial number of requests that can be granted, the second parameter is the maximum concurrent requests. If you're confused over the concept, there are several answers at [stack overflow](http://stackoverflow.com/questions/2837070/lock-statement-vs-monitor-enter-method) that clarifies further.

## Under the hood

By adding a semaphore to the `IPipeContext`[^2], it could be retrieved when setting up the consumer. The consumer action is passed in as `asyncAction` to [a method](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/MessageConsumeMiddleware.cs#L59) that throttles the execution.

```csharp
if (semaphore == null)
{
  _logger.LogDebug("Consuming messages without throttle.");
  Task.Run(asyncAction, ct);
  return;
}
semaphore
  .WaitAsync(ct)
  .ContinueWith(tEnter =>
  {
    try
    {
      Task.Run(asyncAction, ct)
        .ContinueWith(tDone => semaphore.Release(), ct);
    }
    catch (Exception e)
    {
      _logger.LogError("An unhandled exception was thrown", e);
      semaphore.Release();
    }
  }, ct);
```
The code does not expect a semaphore to be present. In fact, by default it isn't, and the normal behavior is to spin up a new task for each message received.

One _very_ important detail when working with semaphores is to always release the lock after the execution. The reason for this is simple: if multiple threads enters but gets interrupted (by exceptions or other) before they get the change to release, the semaphore will be locked indefinitely. There is no guarantees that the `asyncAction` in the example above does not throw, which is why it is surrounded with try/catch.

## Client invokation

How should the semaphore be exposed in the [main interface](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/IBusClient.cs) `IBusClient`? The ambition has always been to keep the it intuitive, and concepts like message throttling is more of an advanced topic. My first thought was to extend the existing, optional configuration builders that are used to tweak just about any aspect of the consume. However, I was a bit hesitant to add the functionality there, as the methods only reflect options from the underlying `RabbitMQ.Client`.

I had to do something, so I added another optional action for `IPipeContext` that could manipulate the pipe context. With the cancellation token, the method now had three optional parameters, which is too much. It was then that I realized the I could move the configuration action to the pipe context action. The result was pretty neat

```csharp
await subscriber.SubscribeAsync<BasicMessage>(async recieved =>
{

  // code goes here.

}, ctx => ctx
  .UseConsumerConcurrency(level: 3) // creates semaphore with max count = 3
  .UseConsumerConfiguration(cfg => cfg
    .Consume(c => c
      .WithRoutingKey("custom_key")
      .WithConsumerTag("custom_tag")
      .WithPrefetchCount(2)
      .WithNoLocal(false))
    .FromDeclaredQueue(q => q
      .WithName("custom_queue")
      .WithAutoDelete()
      .WithArgument(QueueArgument.DeadLetterExchange, "dlx"))
    .OnDeclaredExchange(e=> e
      .WithName("custom_exchange")
      .WithType(ExchangeType.Topic))
));
```
A semaphore can be explicitly provided by calling `UseConsumeSemaphore(semaphore)`. This opens up for users to write custom logic for which semaphore to use/reuse. This has some interesting implications. If _the same semaphore_ is used across the application, the throttling will be "global". The user can provide throttling semaphores for the message types that are prone to put heavy load on the system. If a semaphore is provided with max concurrency set to 1, the message consume will be sequential which might make sense when the execution order is important.

The fact that the semaphore can be provided by the caller is what makes this a powerful feature, with minimal complexity in the client.

## Unexpected synergies

The approach with fluent actions on the `IPipeContext` also opened up for invocation overrides of the client configuration.

```csharp
await secondSubscriber.SubscribeAsync<BasicMessage>(async msg =>
{

    // code goes here.

}, ctx => ctx
  .UseApplicationQueueSuffix() // application name based on .exe
  .UseHostnameQueueSuffix() // hostname based on Environment
  .UseCustomQueueSuffix("custom") // custom suffix
);
```

Other examples includes changing the [request timeout](https://github.com/pardahlman/RawRabbit/blob/2.0/test/RawRabbit.IntegrationTests/Rpc/RpcTimeoutTests.cs#L22) and [publish acknowledge](https://github.com/pardahlman/RawRabbit/blob/2.0/src/RawRabbit/Pipe/Middleware/PublishAcknowledgeMiddleware.cs#L124).

The control over messaging will be even more granular in 2.0. The client comes with a set of default configurations that "makes sense" in most cases. They can be overridden by providing [a custom](https://github.com/pardahlman/RawRabbit/blob/master/src/RawRabbit/Configuration/RawRabbitConfiguration.cs) `RawRabbitConfiguration`. However _that configuration_ can _also be overridden_ for specific calls by using the fluent builder.

#### Footnotes

[^1]: _"an await expression cannot occur in the body of a synchronous function, in a query expression, **in the block of a lock statement**, or in an unsafe context"_
[^2]: Read more about the middleware in this [earlier post]({% post_url 2016-12-25-one-method-to-rule-them-all %})
