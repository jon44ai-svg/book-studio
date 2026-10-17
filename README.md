Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

# Building For Production

To build this application for production:

```bash
pnpm build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
```


## Deploy to Vercel

1. Push this repo to GitHub, GitLab, or Bitbucket
2. In Vercel, choose **Add New > Project** and import the repo
3. Keep the detected TanStack Start framework settings
4. Add production values from `.env.example` under **Settings > Environment Variables**
5. Deploy

Vercel runs the build script and deploys Nitro's output as Vercel Functions and
static assets. The included `vercel.json` makes framework detection explicit.

Variables prefixed with `VITE_` are included in the browser bundle. Keep secrets
unprefixed so they remain server-only.

## Book Studio novella generation

The novella engine uses `GROQ_API_KEY` as the deployment-wide fallback. Signed-in
users can optionally save an encrypted personal Groq key when `DATABASE_URL` and
`GROQ_CREDENTIAL_ENCRYPTION_KEY` are configured. Personal keys are never returned
to the browser after saving.

Production deployments should use Neon Postgres for credential storage and set:

```env
DATABASE_URL=postgresql://...
GROQ_API_KEY=gsk_...
GROQ_CREDENTIAL_ENCRYPTION_KEY=<random-32-byte-secret>
```

Book Studio is installable as a PWA. The app shell and static assets may be
cached, while authentication, server functions, book data, and Groq requests
remain network-only.


## Setting up WorkOS

This integration uses WorkOS AuthKit's full-stack TanStack Start SDK and requires
Node.js 22.11 or newer.

1. Copy your client ID and API key from the [WorkOS dashboard](https://dashboard.workos.com/api-keys).
2. Fill in `.env.local`:

   ```bash
   WORKOS_CLIENT_ID=client_...
   WORKOS_API_KEY=sk_test_...
   WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
   WORKOS_COOKIE_PASSWORD=a-random-value-at-least-32-characters-long
   WORKOS_API_HOSTNAME=api.workos.com
   ```

3. On the dashboard's [Redirects page](https://dashboard.workos.com/redirects), add
   `http://localhost:3000/api/auth/callback` as a redirect URI and
   `http://localhost:3000/api/auth/sign-in` as the sign-in endpoint.
4. Start the app and visit `/demo/workos`.

### What's wired up

- `authkitMiddleware()` manages the encrypted server-side session in `src/start.ts`.
- `/api/auth/callback` completes the OAuth callback.
- `/api/auth/sign-in` initiates sign-in and supports a `returnPathname` query parameter.
- `<AuthKitProvider>` supplies reactive auth state to the header and demo route.

For authorization in loaders and server functions, use `getAuth()` from
`@workos/authkit-tanstack-react-start`. Keep `WORKOS_API_KEY` and
`WORKOS_COOKIE_PASSWORD` server-only, and replace the local callback and sign-in URLs
with their production equivalents when deploying.


## Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
pnpm dlx shadcn@latest add button
```


# Paraglide i18n

This add-on wires up ParaglideJS for localized routing and message formatting.

- Messages live in `project.inlang/messages`.
- URLs are localized through the Paraglide Vite plugin and router `rewrite` hooks.
- Run the dev server or build to regenerate the `src/paraglide` outputs.


# TanStack Chat Application

Am example chat application built with TanStack Start, TanStack Store, and Claude AI.

## .env Updates

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## ✨ Features

### AI Capabilities
- 🤖 Powered by Claude 3.5 Sonnet 
- 📝 Rich markdown formatting with syntax highlighting
- 🎯 Customizable system prompts for tailored AI behavior
- 🔄 Real-time message updates and streaming responses (coming soon)

### User Experience
- 🎨 Modern UI with Tailwind CSS and Lucide icons
- 🔍 Conversation management and history
- 🔐 Secure API key management
- 📋 Markdown rendering with code highlighting

### Technical Features
- 📦 Centralized state management with TanStack Store
- 🔌 Extensible architecture for multiple AI providers
- 🛠️ TypeScript for type safety

## Architecture

### Tech Stack
- **Frontend Framework**: TanStack Start
- **Routing**: TanStack Router
- **State Management**: TanStack Store
- **Styling**: Tailwind CSS
- **AI Integration**: Anthropic's Claude API

# Events Example - Haute Pâtisserie 2026

A beautiful pastry conference website built with TanStack Start and Netlify, featuring:

- **Speakers & Sessions**: Managed with content-collections for easy markdown-based content
- **Conference Schedule**: Day-by-day timeline of all sessions
- **AI Assistant (Remy)**: An AI-powered chat assistant to help attendees navigate the conference
- **Elegant Dark Theme**: Custom typography with Playfair Display and copper/gold accents

## Features

### Content Management
- Speaker profiles with bios, awards, and specialty information
- Session details with topics, duration, and speaker attribution
- All content in markdown files using content-collections

### AI-Powered Assistance
- Chat with "Remy" the culinary assistant
- Search for speakers and sessions by topic
- Get recommendations based on interests
- Supports multiple AI providers (Anthropic, OpenAI, Gemini, Ollama)

### Routes
- `/` - Home page with featured speakers and sessions
- `/schedule` - Conference schedule with day-by-day timeline
- `/speakers` - All speakers grid
- `/speakers/:slug` - Individual speaker detail page
- `/talks` - All sessions grid
- `/talks/:slug` - Individual session detail page

## Getting Started

```bash
# Create a new project with this example
npx netlify-cta my-conference --example events

# Navigate to the project
cd my-conference

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

## AI Configuration

To use the AI assistant, set one of the following environment variables:

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=your-key-here

# OpenAI
OPENAI_API_KEY=your-key-here

# Google Gemini
GEMINI_API_KEY=your-key-here

# Ollama (local, no API key needed)
# Just ensure Ollama is running locally
```

The assistant will automatically use the first available provider.

## Customization

### Adding Speakers
Create a new markdown file in `content/speakers/`:

```markdown
---
name: "Chef Name"
title: "Executive Pastry Chef"
specialty: "French Pastry"
restaurant: "Restaurant Name"
location: "City, Country"
headshot: "speakers/chef-name.jpg"
awards:
  - "Award 1"
  - "Award 2"
---

Bio content here...
```

### Adding Sessions
Create a new markdown file in `content/talks/`:

```markdown
---
title: "Session Title"
speaker: "Chef Name"
duration: "90 minutes"
image: "talks/session-image.jpg"
topics:
  - "Topic 1"
  - "Topic 2"
---

Session description here...
```

## Theme

The example uses a custom dark theme with:
- **Font**: Playfair Display (display) and Cormorant Garamond (body)
- **Colors**: Copper and gold accents on a dark charcoal background
- **Effects**: Elegant card hover animations, grain texture overlay



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).


# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.


# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
