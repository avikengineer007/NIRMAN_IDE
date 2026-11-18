import type { EvalTask } from './types.js';

export const ALL_EVAL_TASKS: readonly EvalTask[] = [
  // --- Category: CLI (6 Tasks) ---
  {
    id: 'task-01-cli-csv-parser',
    title: 'CSV to JSON Converter CLI',
    category: 'cli',
    description:
      'Build a CLI in parse.js that takes a CSV file path as an argument and outputs a valid JSON array of objects representing the rows.',
    initialFiles: {
      'input.csv': 'name,age,role\nAlice,30,Developer\nBob,25,Designer\nCharlie,35,Manager\n',
    },
    checks: [
      {
        type: 'test',
        description: 'Parses input.csv and outputs valid JSON objects',
        command: 'node parse.js input.csv',
        expectedOutput: '"name": "Alice"',
      },
    ],
  },
  {
    id: 'task-02-cli-markdown-toc',
    title: 'Markdown Table of Contents Generator',
    category: 'cli',
    description:
      'Build a CLI in toc.js that reads README.md and extracts all markdown headings (# through ###) into a nested bulleted Table of Contents with slugified anchor links.',
    initialFiles: {
      'README.md': '# Project Overview\n\n## Architecture\n\n### Core Loop\n\n## Getting Started\n',
    },
    checks: [
      {
        type: 'test',
        description: 'Generates markdown table of contents with anchors',
        command: 'node toc.js README.md',
        expectedOutput: '- [Architecture](#architecture)',
      },
    ],
  },
  {
    id: 'task-03-cli-env-validator',
    title: 'Environment Variable Schema Validator',
    category: 'cli',
    description:
      'Build a CLI in env-check.js that reads schema.json and .env, verifying that required environment variables exist and match specified types. Exits 0 if valid, 1 if missing.',
    initialFiles: {
      'schema.json': '{"PORT": "number", "DATABASE_URL": "string", "DEBUG": "boolean"}',
      '.env': 'PORT=8080\nDATABASE_URL=postgres://localhost:5432/app\nDEBUG=true\n',
    },
    checks: [
      {
        type: 'test',
        description: 'Verifies .env against schema.json and exits 0',
        command: 'node env-check.js',
        expectedExitCode: 0,
      },
    ],
  },
  {
    id: 'task-04-cli-log-analyzer',
    title: 'Web Server Access Log Analyzer',
    category: 'cli',
    description:
      'Build a CLI in analyze.js that reads access.log, aggregates HTTP status codes (2xx, 4xx, 5xx), and prints total requests and error percentage in JSON format.',
    initialFiles: {
      'access.log':
        '127.0.0.1 - - "GET / HTTP/1.1" 200\n127.0.0.1 - - "GET /api HTTP/1.1" 200\n127.0.0.1 - - "GET /fail HTTP/1.1" 500\n127.0.0.1 - - "GET /missing HTTP/1.1" 404\n',
    },
    checks: [
      {
        type: 'test',
        description: 'Aggregates access log requests and outputs status statistics',
        command: 'node analyze.js access.log',
        expectedOutput: '"totalRequests": 4',
      },
    ],
  },
  {
    id: 'task-05-cli-uuid-generator',
    title: 'UUID and Slug Generator CLI',
    category: 'cli',
    description:
      "Build a CLI in uuid-gen.js that generates v4 UUIDs or slugs. When passed --slug 'Hello World! How Are You?', outputs 'hello-world-how-are-you'.",
    checks: [
      {
        type: 'test',
        description: 'Generates normalized URL slug from input string',
        command: 'node uuid-gen.js --slug "Hello World! How Are You?"',
        expectedOutput: 'hello-world-how-are-you',
      },
    ],
  },
  {
    id: 'task-06-cli-word-frequency',
    title: 'Word Frequency Counter',
    category: 'cli',
    description:
      'Build a CLI in word-freq.js that parses document.txt, counts word occurrences (case-insensitive), and prints the top most frequent words as JSON.',
    initialFiles: {
      'document.txt':
        'The quick brown fox jumps over the lazy dog. The fox was quick and the dog was lazy. The fox slept.',
    },
    checks: [
      {
        type: 'test',
        description: 'Outputs word frequency rank as JSON',
        command: 'node word-freq.js document.txt',
        expectedOutput: '"the": 5',
      },
    ],
  },

  // --- Category: REST API (6 Tasks) ---
  {
    id: 'task-07-api-todo-crud',
    title: 'In-Memory Todo REST API',
    category: 'api',
    description:
      'Build an HTTP REST API in server.js on port 4001 with GET /todos returning an array of items, and POST /todos creating a new item with id and title.',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /todos returns JSON array with status 200',
        startCommand: 'node server.js',
        port: 4001,
        path: '/todos',
        method: 'GET',
        expectedStatus: 200,
        expectedBodySubstr: '[]',
      },
    ],
  },
  {
    id: 'task-08-api-auth-token',
    title: 'Token Authentication Service',
    category: 'api',
    description:
      'Build an HTTP service in server.js on port 4002 with POST /login returning { token: "secret-token" }, and GET /profile requiring Authorization: Bearer secret-token (returning 401 without it).',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /profile returns 401 Unauthorized without auth header',
        startCommand: 'node server.js',
        port: 4002,
        path: '/profile',
        method: 'GET',
        expectedStatus: 401,
      },
    ],
  },
  {
    id: 'task-09-api-url-shortener',
    title: 'URL Shortener API',
    category: 'api',
    description:
      'Build a URL shortener in server.js on port 4003 with POST /shorten accepting { url: string } and returning a short code, and GET /health returning status ok.',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /health returns status ok',
        startCommand: 'node server.js',
        port: 4003,
        path: '/health',
        method: 'GET',
        expectedStatus: 200,
        expectedBodySubstr: '"status":"ok"',
      },
    ],
  },
  {
    id: 'task-10-api-rate-limiter',
    title: 'Rate Limiter API Gateway',
    category: 'api',
    description:
      'Build an HTTP API in server.js on port 4004 with a rate limiter allowing requests under limit, returning JSON with allowed: true.',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /api/data returns allowed: true with status 200',
        startCommand: 'node server.js',
        port: 4004,
        path: '/api/data',
        method: 'GET',
        expectedStatus: 200,
        expectedBodySubstr: '"allowed":true',
      },
    ],
  },
  {
    id: 'task-11-api-notes-search',
    title: 'Notes API with Keyword Search',
    category: 'api',
    description:
      'Build an API in server.js on port 4005 with GET /notes?q=keyword returning items matching query.',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /notes returns 200 OK with notes array',
        startCommand: 'node server.js',
        port: 4005,
        path: '/notes',
        method: 'GET',
        expectedStatus: 200,
        expectedBodySubstr: '[]',
      },
    ],
  },
  {
    id: 'task-12-api-health-metrics',
    title: 'Server Health & Metrics API',
    category: 'api',
    description:
      'Build a server in server.js on port 4006 with GET /health returning { status: "healthy", uptime: number }.',
    checks: [
      {
        type: 'endpoint',
        description: 'GET /health returns healthy status',
        startCommand: 'node server.js',
        port: 4006,
        path: '/health',
        method: 'GET',
        expectedStatus: 200,
        expectedBodySubstr: '"status":"healthy"',
      },
    ],
  },

  // --- Category: UI (6 Tasks) ---
  {
    id: 'task-13-ui-calculator',
    title: 'Calculator Web Interface',
    category: 'ui',
    description:
      'Build a web calculator in index.html and app.js with number buttons, operators (+, -, *, /), and a calculation display.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains calculator buttons, operators, and display',
        filePath: 'index.html',
        requiredKeywords: ['button', 'display', 'operator'],
      },
    ],
  },
  {
    id: 'task-14-ui-stopwatch',
    title: 'Interactive Digital Stopwatch',
    category: 'ui',
    description:
      'Build a digital stopwatch in index.html and stopwatch.js with Start, Pause, and Reset controls and elapsed time display.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains stopwatch controls (start, pause, reset)',
        filePath: 'index.html',
        requiredKeywords: ['start', 'pause', 'reset'],
      },
    ],
  },
  {
    id: 'task-15-ui-color-picker',
    title: 'Color Palette & Hex Converter UI',
    category: 'ui',
    description:
      'Build a color picker interface in index.html with color input, hex-to-rgb converter, and preview swatch.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains color picker and preview elements',
        filePath: 'index.html',
        requiredKeywords: ['color', 'hex', 'rgb'],
      },
    ],
  },
  {
    id: 'task-16-ui-shopping-cart',
    title: 'E-Commerce Shopping Cart Widget',
    category: 'ui',
    description:
      'Build an e-commerce shopping cart in index.html with item list, Add to Cart buttons, and total price calculation.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains shopping cart item list and total price',
        filePath: 'index.html',
        requiredKeywords: ['cart', 'price', 'total'],
      },
    ],
  },
  {
    id: 'task-17-ui-accordion-faq',
    title: 'Accessible FAQ Accordion Component',
    category: 'ui',
    description:
      'Build an accordion FAQ component in index.html with question headers and collapsible answer panels.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains accordion FAQ questions and answers',
        filePath: 'index.html',
        requiredKeywords: ['accordion', 'question', 'answer'],
      },
    ],
  },
  {
    id: 'task-18-ui-form-validator',
    title: 'Registration Form with Live Validation',
    category: 'ui',
    description:
      'Build a registration form in index.html with email, password, and error display for validation.',
    checks: [
      {
        type: 'ui',
        description: 'index.html contains registration form inputs and validation error elements',
        filePath: 'index.html',
        requiredKeywords: ['form', 'email', 'password'],
      },
    ],
  },

  // --- Category: Algorithms & Utilities (2 Tasks) ---
  {
    id: 'task-19-algo-lru-cache',
    title: 'LRU Cache Data Structure',
    category: 'algo',
    description:
      'Build an LRUCache class in lru.js with constructor(capacity), get(key), and put(key, value). When capacity is exceeded, evicts the least recently used key. A test script test-lru.js tests put, get, and eviction.',
    initialFiles: {
      'test-lru.js': `
const { LRUCache } = require('./lru.js');
const cache = new LRUCache(2);
cache.put(1, 1);
cache.put(2, 2);
if (cache.get(1) !== 1) throw new Error('get(1) failed');
cache.put(3, 3); // evicts 2
if (cache.get(2) !== -1 && cache.get(2) !== undefined) throw new Error('eviction failed');
console.log('LRU Cache tests passed');
`,
    },
    checks: [
      {
        type: 'test',
        description: 'Verifies LRU cache put, get, and eviction semantics',
        command: 'node test-lru.js',
        expectedOutput: 'LRU Cache tests passed',
      },
    ],
  },
  {
    id: 'task-20-algo-event-emitter',
    title: 'Custom Event Emitter',
    category: 'algo',
    description:
      'Build an EventEmitter class in emitter.js with on(event, listener), emit(event, ...args), off(event, listener), and once(event, listener). test-emitter.js runs automated assertions.',
    initialFiles: {
      'test-emitter.js': `
const { EventEmitter } = require('./emitter.js');
const ee = new EventEmitter();
let count = 0;
ee.on('tick', () => { count++; });
ee.emit('tick');
ee.emit('tick');
if (count !== 2) throw new Error('on/emit failed');
console.log('EventEmitter tests passed');
`,
    },
    checks: [
      {
        type: 'test',
        description: 'Verifies EventEmitter on, emit, and once behavior',
        command: 'node test-emitter.js',
        expectedOutput: 'EventEmitter tests passed',
      },
    ],
  },
];
