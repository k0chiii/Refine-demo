Run headless Chrome on [Cloudflare's global network](/workers/) for browser automation, web scraping, testing, and content generation.

Available on Free and Paid plans

Browser Run, formerly known as Browser Rendering, enables developers to programmatically control and interact with headless browser instances running on Cloudflare’s global network.

## Use cases

Programmatically load and fully render dynamic webpages or raw HTML and capture specific outputs such as:

- [Markdown](/browser-run/quick-actions/markdown-endpoint/)

- [Screenshots](/browser-run/quick-actions/screenshot-endpoint/)

- [PDFs](/browser-run/quick-actions/pdf-endpoint/)

- [Snapshots](/browser-run/quick-actions/snapshot/)

- [Links](/browser-run/quick-actions/links-endpoint/)

- [HTML elements](/browser-run/quick-actions/scrape-endpoint/)

- [Structured data](/browser-run/quick-actions/json-endpoint/)

- [Crawled web content](/browser-run/quick-actions/crawl-endpoint/)

## Integration methods

Browser Run offers two categories of integration methods:

- [Quick Actions](/browser-run/quick-actions/): Simple, stateless browser tasks like screenshots, PDFs, and scraping. No code deployment needed.

- Browser Sessions: Direct browser control via [Puppeteer](/browser-run/puppeteer/), [Playwright](/browser-run/playwright/), [CDP](/browser-run/cdp/), or [Stagehand](/browser-run/stagehand/). Deploy within Cloudflare Workers or connect from any environment via CDP.

Use case | Recommended | Why
Simple screenshot, PDF, or scrape | [Quick Actions](/browser-run/quick-actions/) | No code deployment; single HTTP request
Browser automation | [Playwright](/browser-run/playwright/), [Puppeteer](/browser-run/puppeteer/), or [CDP](/browser-run/cdp/) | Full browser control with scripting
Porting existing scripts | [Puppeteer](/browser-run/puppeteer/), [Playwright](/browser-run/playwright/), or [CDP](/browser-run/cdp/) | Minimal code changes from standard libraries
AI-powered data extraction | [JSON endpoint](/browser-run/quick-actions/json-endpoint/) | Structured data via natural language prompts
Site-wide crawling | [Crawl endpoint](/browser-run/quick-actions/crawl-endpoint/) | Multi-page content extraction with async results
AI agent browsing | [Playwright MCP](/browser-run/playwright/playwright-mcp/) or [CDP with MCP clients](/browser-run/cdp/mcp-clients/) | LLMs control browsers via MCP
Resilient scraping | [Stagehand](/browser-run/stagehand/) | AI finds elements by intent, not selectors
Direct browser control from any environment | [CDP](/browser-run/cdp/) | WebSocket access from local machines, CI/CD, or external servers

## Key features

- Scale to thousands of browsers: Instant access to a global pool of browsers with low cold-start time, ideal for high-volume screenshot generation, data extraction, or automation at scale

- Global by default: Browser sessions run on Cloudflare's edge network, opening close to your users for better speed and availability worldwide

- Easy to integrate: [Quick Actions](/browser-run/quick-actions/) for common tasks, [Puppeteer](/browser-run/puppeteer/) and [Playwright](/browser-run/playwright/) for complex workflows, and [CDP](/browser-run/cdp/) for direct browser control from any environment

- Session management: [Reuse browser sessions](/browser-run/features/reuse-sessions/) across requests to improve performance and reduce cold-start overhead

- Flexible pricing: Pay only for browser time used with generous free tier ([view pricing](/browser-run/pricing/))

## Related products

[Workers](/workers/)

Build serverless applications and deploy instantly across the globe for exceptional performance, reliability, and scale.

[Durable Objects](/durable-objects/)

A globally distributed coordination API with strongly consistent storage. Using Durable Objects to [persist browser sessions](/browser-run/how-to/browser-run-with-do/) improves performance by eliminating the time that it takes to spin up a new browser session.

[Agents](/agents/)

Build AI-powered agents that autonomously navigate websites and perform tasks using [Playwright MCP](/browser-run/playwright/playwright-mcp/) or [Stagehand](/browser-run/stagehand/).

## More resources

### [Get started](/browser-run/get-started/)

Choose an integration method and deploy your first project.

### [Limits](/browser-run/limits/)

Learn about Browser Run limits.

### [Pricing](/browser-run/pricing/)

Learn about Browser Run pricing.

### [Playwright API](/browser-run/playwright/)

Use Cloudflare's fork of Playwright for testing and automation.

### [Developer Discord](https://discord.cloudflare.com)

Connect with the Workers community on Discord to ask questions, show what you are building, and discuss the platform with other developers.

### [@CloudflareDev](https://x.com/cloudflaredev)

Follow @CloudflareDev on Twitter to learn about product announcements, and what is new in Cloudflare Workers.
