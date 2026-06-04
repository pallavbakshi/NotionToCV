#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

// Map content types for static server
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node print.cjs <path-to-resume.json> [output-pdf-name]');
    process.exit(1);
  }

  const jsonPath = path.resolve(args[0]);
  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: File not found at ${jsonPath}`);
    process.exit(1);
  }

  let resumeData;
  try {
    resumeData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error(`Error: Failed to parse JSON at ${jsonPath}: ${err.message}`);
    process.exit(1);
  }

  const outputPdfName = args[1] || `${path.basename(jsonPath, '.json')}.pdf`;
  const distDir = path.resolve(__dirname, 'dist');

  if (!fs.existsSync(distDir)) {
    console.error('Error: Build directory "dist/" does not exist. Please run "npm run build" first.');
    process.exit(1);
  }

  const printId = Math.random().toString(36).substring(2, 9);
  
  // Create a minimal HTTP static file server
  const server = http.createServer((req, res) => {
    // 1. Mock the API print-data endpoint
    if (req.url.startsWith('/api/print-data')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        blocks: resumeData.blocks || [],
        pageTitle: resumeData.pageTitle || 'Untitled',
        paddingMm: resumeData.paddingMm || 15,
        templateName: resumeData.templateName || 'clean',
        customTemplates: resumeData.customTemplates || {}
      }));
      return;
    }

    // 2. Serve static files from dist/
    let filePath = path.join(distDir, req.url.split('?')[0]);
    if (filePath === distDir || req.url.split('?')[0] === '/') {
      filePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`500 Server Error: ${err.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  // Start the server on an ephemeral port
  server.listen(0, '127.0.0.1', async () => {
    const address = server.address();
    const port = address.port;
    console.log(`Temporary print server running at http://127.0.0.1:${port}`);

    let hasError = false;
    try {
      console.log('Launching headless browser...');
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();

      const url = `http://127.0.0.1:${port}/?export=true&printId=${printId}`;
      console.log(`Navigating page to print URL: ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle0'
      });

      console.log('Generating A4 PDF...');
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '0px',
          bottom: '0px',
          left: '0px',
          right: '0px'
        }
      });

      fs.writeFileSync(outputPdfName, pdfBuffer);
      console.log(`Success! PDF successfully exported to ${path.resolve(outputPdfName)}`);

      await browser.close();
    } catch (err) {
      console.error(`Error printing PDF: ${err.message}`);
      hasError = true;
    } finally {
      server.close(() => {
        console.log('Temporary print server shut down.');
        process.exit(hasError ? 1 : 0);
      });
    }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
