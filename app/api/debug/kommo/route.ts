import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}` };

  const [account, pipelines] = await Promise.all([
    axios.get(`${base}/account`, { headers, validateStatus: () => true })
      .then((r) => ({ status: r.status, data: r.data }))
      .catch((e) => ({ error: String(e) })),
    axios.get(`${base}/leads/pipelines`, { params: { with: 'statuses', limit: 50 }, headers, validateStatus: () => true })
      .then((r) => ({ status: r.status, data: r.data }))
      .catch((e) => ({ error: String(e) })),
  ]);

  return NextResponse.json({ subdomain, base, account, pipelines });
}
