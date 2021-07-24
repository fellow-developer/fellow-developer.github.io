📚 The blog at [fellowdeveloper.se](https://fellowdeveloper.se).

Get it up and running in docker

```
docker run --rm  --volume="$PWD:/srv/jekyll" --publish 4000:4000 jekyll/jekyll jekyll serve
```
