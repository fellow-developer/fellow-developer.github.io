---
title: Unexpected AutoMapper behavior
authors: [pardahlman]
tags: [dotnet]
---

With every upgrade of a major version of `AutoMapper` there are many things that break. Recently I've been involved in upgrading not one or two majors but from 8.x to the latest and presumably greatest 13.0.1. After removing calls to obsolete methods, removing duplicate and explicitly added mappings of child types that previously was inferred. The migration was done. The confidence was high as the unit tests that verified the mapping configuration passed:

```csharp
new MapperConfiguration(cfg => cfg.AddProfile<Profile>())
  .AssertConfigurationIsValid();
```

A few seconds after the code was deployed errors started to appear in the application log. 

_That's strange._

<!-- truncate -->

Because this was real life, the profile contained so much mapping of complex objects that is was difficult to identify what had happened. Finally, I managed to create [a small repro app](https://github.com/pardahlman/automapper-repro). Basically `AssertConfigurationIsValid` fails to detect that mapping of concrete types is missing if said type implements interface that is registered. Let's have a look at an example:

```csharp title="Source types" showLineNumbers
public interface ISourceProperty { }

public record SourceProperty : ISourceProperty;

public class SourceRoot
{
  public SourceProperty Property { get; set; }
}
```

Here `SourceRoot` has a property of concrete type `SourceProperty` that happens to implement `ISourceProperty`. The destination types are copies, but obviously named differently 😉

```csharp title="Destination types" showLineNumbers
public interface IDestinationProperty { }

public record DestinationProperty : IDestinationProperty;

public class DestinationRoot
{
  public DestinationProperty Property { get; set; }
}
```

With the following mapper configuration

```csharp title="Mapper configuration" showLineNumbers
var mapperConfiguration = new MapperConfiguration(cfg =>
{
    cfg.CreateMap<SourceRoot, DestinationRoot>();
    cfg.CreateMap<ISourceProperty, IDestinationProperty>();
});
```

The `mapperConfiguration.AssertConfigurationIsValid()` does not throw, even though the concrete types for the `Property` property is not registered. When trying to use AutoMapper to actually map between `SourceRoot` and `DestinationRoot` an exception is thrown

```
Unhandled exception. AutoMapper.AutoMapperMappingException: Error mapping types.

Mapping types:
SourceRoot -> DestinationRoot
SourceRoot -> DestinationRoot

Type Map configuration:
SourceRoot -> DestinationRoot
SourceRoot -> DestinationRoot

Destination Member:
Property
```

I [raised the issue over at GitHub](https://github.com/AutoMapper/AutoMapper/issues/4504), but it was closed without making it clear to me if this is a bug that will be fixed or if it is by design 🤷.

## Temporary workaround

Until this has been address in `AutoMapper`, the only way to know for certain if the mapping is correct is to try to perform mapping of the "root objects" in a unit test. This is what the application code does, after all.