import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import puppeteer from 'puppeteer'

const printCache = new Map();

function printPlugin() {
  return {
    name: 'vite-plugin-print-pdf',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/print' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const printId = Math.random().toString(36).substring(2, 9);
              printCache.set(printId, data);

              // Launch Puppeteer
              const browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
              });
              const page = await browser.newPage();

              // Get the local address
              const address = server.httpServer.address();
              const port = address.port;
              // Make sure to resolve to ipv4 localhost
              const host = '127.0.0.1';
              const url = `http://${host}:${port}/?export=true&printId=${printId}`;

              await page.goto(url, {
                waitUntil: 'networkidle0'
              });

              // Generate PDF
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

              await browser.close();
              printCache.delete(printId);

              // Respond with PDF binary
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="${data.pageTitle || 'resume'}.pdf"`);
              res.end(pdfBuffer);
            } catch (err) {
              console.error('Error generating PDF:', err);
              res.statusCode = 500;
              res.end('Error generating PDF: ' + err.message);
            }
          });
        } else if (req.url.startsWith('/api/print-data') && req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost');
          const id = url.searchParams.get('id');
          const data = printCache.get(id);
          if (data) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } else {
            res.statusCode = 404;
            res.end('Not found');
          }
        } else {
          next();
        }
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), printPlugin()],
})
