const SLACK_CHANNEL_ID = 'C06909QFJD6'; // #web-leads

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const { firstName, lastName, email, company, phone, revenue, interest, role, message } = data;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const name = `${firstName || ''} ${lastName || ''}`.trim();

    // Send Slack notification to #web-leads
    try {
      const slackBlocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Augentic AI — New Lead', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Name:*\n${name || 'N/A'}` },
            { type: 'mrkdwn', text: `*Email:*\n${email}` },
            { type: 'mrkdwn', text: `*Company:*\n${company || 'N/A'}` },
            { type: 'mrkdwn', text: `*Phone:*\n${phone || 'N/A'}` },
            { type: 'mrkdwn', text: `*Revenue:*\n${revenue || 'N/A'}` },
            { type: 'mrkdwn', text: `*Interest:*\n${interest || 'N/A'}` },
          ],
        },
      ];

      if (role || message) {
        const extraFields = [];
        if (role) extraFields.push({ type: 'mrkdwn', text: `*Role:*\n${role}` });
        if (message) extraFields.push({ type: 'mrkdwn', text: `*Message:*\n${message}` });
        slackBlocks.push({ type: 'section', fields: extraFields });
      }

      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: SLACK_CHANNEL_ID,
          text: `Augentic AI — New lead: ${name} (${email})`,
          blocks: slackBlocks,
        }),
      });
    } catch (err) {
      console.error('Slack error:', err);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  },
};
