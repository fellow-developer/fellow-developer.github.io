import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Fellow Developer',
  tagline: 'Blog from a fellow developer to another',
  favicon: 'img/favicon.ico',

  url: 'https://fellowdeveloper.se',
  baseUrl: '/',

  organizationName: 'fellow-developer',
  projectName: 'fellow-developer.github.io',
  deploymentBranch: 'main',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: false,
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          routeBasePath: '/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Fellow Developer',
      items: [
        {to: '/about', label: 'About', position: 'right'}
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          label: 'GitHub',
          href: 'https://github.com/fellow-developer',
        },
        {
          label: 'LinkedIn',
          href: 'https://linkedin.com/company/fellow-developer',
        },
        {
          label: 'X',
          href: 'https://x.com/fellowdeveloper',
        }
      ],
      copyright: `${new Date().getFullYear()} Fellow Developer`,
    },
    prism: {
      additionalLanguages: ['csharp', 'powershell'],
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
