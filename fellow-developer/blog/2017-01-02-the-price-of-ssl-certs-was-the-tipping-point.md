---
title: The year of secure internet connections
authors: pardahlman
tags: [security]
---

## Times are a-changin'
It was the price of SSL cert that was the tipping point for me. In general, I like paying for high quality services. Companies like [Github](https://github.com) is a perfect example; low up-front cost, easy to use interface and a bunch of useful integrations that _actually_ increases productivity.

<!-- truncate -->

Other companies have a different business model, where the only revenue stream steams from the knowledge that people wont go about changing things that _works_, even though it is not an optimal solution.

Back when I first registered my very first domain, I found a hosting company that had a package deal; I could set up one-click blogs, access a web based email client and deploy my site over FTP.

This was the state of affairs for several years. To be honest I didn't deploy that frequently to bother with any sophisticated CI. I didn't use the email accounts enough to bother with the outdated design. One thing that do matter for me is privacy and secure connections over the internet, and it was the pursuit of this that was the wake-up call me.

## Security and privacy

The most important point of secure communication is the privacy aspect. In the [post-Snowden world](http://documentary-movie.com/citizenfour/), it is obvious that governments engage is mass surveillance. This is the reason for initiatives like [Encrypt all the things](https://encryptallthethings.net/), that highlights the ease "by which unauthorized actors can access large amounts of personal information without any judicial process or oversight".

Luckily, Google is pushing hard for https and they have the muscle to make it a business priority. Back in 2014, they [announced](https://security.googleblog.com/2014/08/https-as-ranking-signal_6.html) that sites with secure connections will rank higher. The next step in their plan will be taken early 2017. The upcoming [version 56 of Chrome](https://blog.chromium.org/2016/12/chrome-56-beta-not-secure-warning-web.html), will flag login/payment pages _not using https_ as "Not Secure".

Long story short, TLS is almost a hygiene factor[^1], but it has always been something that comes with a price tag and complicated process of installation and renewal. This was before [Let's Encrypt](https://letsencrypt.org), that not only automates the process, but makes it cost free, too! If you haven't heard about Let's Encrypt, head over and read about their mission.

To my surprise, my hosting company didn't offer Let's Encrypt. They sold the certificates from one of the larger vendors for a pretty hefty price. It annoyed me when I realized that if I bought the certs from them, it was almost double the price as if I would go to a Certificate Authority myself. When asking them about it, they replied it was due to "installation costs".

## Let's encrypt at Azure
It was this that finally made me begin migrate my sites to [Azure](https://azure.microsoft.com). I was hesitant, as Microsoft is known to [collaborate with US government](http://news.softpedia.com/news/Leaked-Documents-Shows-the-NSA-Had-Full-Access-to-Skype-Chats-468691.shtml). What convinced me is that they have [taken steps](http://windowsitpro.com/cloud/microsoft-opens-azure-cloud-germany-even-it-cant-access-easily) to make data inaccessible to NSA (and even themselves!) in order to provide data privacy. Hopefully they will continue to work for privacy, as I believe that is going to be something that organizations will look at when deciding on hosting.

It took me about one hour to get TLS working. Azure's [site extensions](https://azure.microsoft.com/en-us/blog/azure-web-sites-extensions/) is a cool way to add functionality to an Azure App. There are [not that many extensions](http://www.siteextensions.net/packages), but amongst them I found [Azure Let's Encrypt](http://www.siteextensions.net/packages/letsencrypt/), that automates the installation and updates of the [short-lived](https://letsencrypt.org/2015/11/09/why-90-days.html) certificates. There are great [installation instructions](https://github.com/sjkp/letsencrypt-siteextension/wiki/How-to-install) at the project site that I followed. It was a bit tricky, as the instructions involved creating and configuring a service principal in Azure classic mode[^2] before setting up the web jobs. I always get disoriented in the legacy parts of Azure, and it feels like the things done there are totally separated from everything else.

I really like that there is a cost and friction free way to get https working. Let's Encrypt is a perfect option for the large segment of middle-sized sites with a too small budget for SSL certs. There are good reasons and arguments for taking the time to secure the sites you are working on. Let's make 2017 about privacy.


[^1]: Currently [not supported for Github Pages](https://github.com/isaacs/github/issues/156), which is the reason why this blog is still over http.
[^2]: I do believe that you could follow [this guide](https://docs.microsoft.com/en-us/azure/azure-resource-manager/resource-group-create-service-principal-portal) to set up a service principal without entering classic mode.
