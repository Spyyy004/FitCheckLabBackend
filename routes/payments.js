import { Webhook } from "standardwebhooks";
import { headers } from "next/headers";
import { WebhookPayload } from "@/types/api-types";

const webhook = new Webhook(process.env.NEXT_PUBLIC_DODO_WEBHOOK_KEY); // Replace with your secret key generated from the Dodo Payments Dashboard

export async function POST(request) {
  const headersList = headers();
  const rawBody = await request.text();

  const webhookHeaders = {
    "webhook-id": headersList.get("webhook-id") || "",
    "webhook-signature": headersList.get("webhook-signature") || "",
    "webhook-timestamp": headersList.get("webhook-timestamp") || "",
  };

  await webhook.verify(rawBody, webhookHeaders);
  const payload = JSON.parse(rawBody);

  console.log(payload,"PAYLOADD")
  
  // Process the payload according to your business logic
}