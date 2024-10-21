---
title: Seven lines of code in the pipeline
authors: [pardahlman]
tags: [dotnet, tooling]
---

There are a few resemblance between a CI pipeline and a kitchen sink. When it has just been installed it does its job efficiently and after a while its functionality is taken for granted. But the same way that a sink becomes clogged over time, a pipeline tend to grow slow, complex and/or bloated. An just like with the sink, the change is incremental and slow that it's hard to notice the decay. And lastly, before this comparison is put aside: they are both integral components in crucial workflows. 

<!-- truncate -->

A build system usually creates two type of artifacts: deployables (that is usually applications, but in theory can be other types of software like stand-alone database migrations) and packages (software that can be used in applications). Automated test suites are often run to ensure functionality and avoid regression. For modern applications, the deployables are usually Docker images and in .NET the packages are of course [NuGet packages](https://nuget.org).

It's good practice to let all artifacts produced by the build system have the same version. While [semantic versioning](https://semver.org/) has a lot of benefits, it is time consuming and error prone to evaluate the changes made in every pull request and adjust version based on them. An approach that I've found good-enough is to let `major` and `minor` signal big or breaking changes, and have `patch` be an incrementally counter set by the build system. Pre-releases are built on non-default branch and are usually suffixed with the branch name (`[major].[minor].[patch]-[branch]`).

The above can be achieved by leveraging [`Directory.Build.props`](https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-by-directory?view=vs-2022#directorybuildprops-and-directorybuildtargets) and setting `Version`

```xml title="Directory.Build.props" showLineNumbers
<PropertyGroup>
  <MinorAndPreRelease Condition="'$(MinorAndPreRelease)' == '' ">0</MinorAndPreRelease>
  <Version>2.1.$(MinorAndPreRelease)</Version>
</PropertyGroup>
```

The `MinorAndPreRelease` variable is provided from the CI pipeline with a fallback to `0` if it is not provided (e.g. local build). Without further ado, here's the first line of code, using [GitLab predefined variables](https://docs.gitlab.com/ee/ci/variables/predefined_variables.html) `CI_COMMIT_BRANCH`, `CI_DEFAULT_BRANCH` and `CI_PIPELINE_IID`:

```bash
MINORPRERELEASE=$([[ "$CI_COMMIT_BRANCH" == "$CI_DEFAULT_BRANCH" ]] && echo "$CI_PIPELINE_IID" || echo "$CI_PIPELINE_IID-$CI_COMMIT_BRANCH")
```

With this piece of art in place we can create a naive script using the `dotnet` CLI

```bash showLineNumbers
dotnet build -c Release -p Foo=Bar
dotnet test -c Release --no-build
dotnet pack --no-build -o dist
dotnet publish --no-build
```

A slight problem, though - by default all project in the solution are being packed into NuGet packages and in the same way all projects are being published, too. `Directory.Build.props` to the rescue again:

```xml title="Directory.Build.props" showLineNumbers
<PropertyGroup>
  <IsPackable>false</IsPackable>
  <IsPublishable>false</IsPublishable>
</PropertyGroup>
```

This creates a predictable baseline that can be overridden in the projects (by setting corresponding properties to `true`). The next issue to address is how to find the relevant publish artifacts, resolve their `Dockerfile` to know what base image to use and all that jazz. This is where [the `PublishContainer` publish target](https://learn.microsoft.com/en-us/dotnet/core/docker/publish-as-container) can simplify the build process further. First, the csproj files need to be updated with 

```xml title="Worker.csproj showLineNumbers
<PropertyGroup>
  <ContainerBaseImage>mcr.microsoft.com/dotnet/runtime:8.0</ContainerBaseImage>
  <ContainerRepository>domain/worker</ContainerRepository>
  <ContainerImageTag>$(Version);$(CI_COMMIT_SHORT_SHA)</ContainerImageTag>
</PropertyGroup>
```

Most things here are self-explanatory, `ContainerBaseImage` is the image to base the application image. The `ContainerRepository` is the [repository part](https://learn.microsoft.com/en-us/dotnet/core/docker/publish-as-container?pivots=dotnet-8-0#container-image-naming-configuration) of the Docker image name and the tags are the version (as described above) and the short form of the commit that is built.

With that in place, the entire build pipeline can be updated to look like this

```yaml title=".gitlab-ci.yaml" showLineNumbers
Build-Test-Publish:
  image: mcr.microsoft.com/dotnet/sdk:8.0.403
  script:
  // highlight-start
    - MINORPRERELEASE=$([[ "$CI_COMMIT_BRANCH" == "$CI_DEFAULT_BRANCH" ]] && echo "$CI_PIPELINE_IID" || echo "$CI_PIPELINE_IID-$CI_COMMIT_BRANCH")
    - dotnet build -c Release /p MinorAndPreRelease=$MINORPRERELEASE
    - dotnet format whitespace --no-restore --verify-no-changes
    - dotnet test -c Release --no-build
    - dotnet pack --no-build -o dist /p MinorAndPreRelease=$MINORPRERELEASE
    - dotnet publish --os linux --arch x64 /t:PublishContainer /p MinorAndPreRelease=$MINORPRERELEASE /p ContainerRegistry=europe-docker.pkg.dev
    - dotnet nuget push dist/*.nupkg
// highlight-end
```

That's it. These commands are simple enough to be run locally when trouble shooting.