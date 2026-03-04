/**
 * Vercel serverless function: /api/ado-proxy
 *
 * Proxies Azure DevOps REST API calls from the browser, bypassing CORS.
 *
 * Usage (POST from browser):
 *   fetch('/api/ado-proxy', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       url: 'https://dev.azure.com/org/project/_apis/...',
 *       method: 'GET' | 'POST' | 'PATCH',
 *       pat: '<PAT token>',
 *       body: { ...optional request body },
 *       contentType: 'application/json' // optional override
 *     })
 *   })
 *
 * The PAT never leaves your Vercel deployment — it goes straight
 * from the browser to this function to Azure DevOps.
 */
export default async function handler(req, res) {
  // Only allow POST to this proxy
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, method = 'GET', pat, body, contentType } = req.body || {};

  if (!url || !pat) {
    return res.status(400).json({ error: 'Missing url or pat' });
  }

  // Only allow Azure DevOps URLs
  if (!url.startsWith('https://dev.azure.com/')) {
    return res.status(403).json({ error: 'Only Azure DevOps URLs are allowed' });
  }

  try {
    const headers = {
      'Authorization': 'Basic ' + Buffer.from(':' + pat).toString('base64'),
      'Content-Type': contentType || 'application/json',
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const adoRes = await fetch(url, fetchOptions);
    const text = await adoRes.text();

    // Forward the status and body back
    res.status(adoRes.status);
    res.setHeader('Content-Type', 'application/json');

    if (!adoRes.ok) {
      return res.end(JSON.stringify({ error: `ADO ${adoRes.status}`, detail: text.slice(0, 500) }));
    }

    return res.end(text);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
