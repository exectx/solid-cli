# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npx xsc create

# create a new project in my-app
npx xsc create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run start`.

> To deploy your app, you may need to install an [adapter](https://docs.solidjs.com/solid-start/reference/config/define-config#configuring-nitro) for your target environment.
