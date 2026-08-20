// Payment gateway integration — Razorpay (INR) and Nomod (AED/USD)

export interface GatewayOrderResult {
  gateway:     "RAZORPAY" | "NOMOD";
  orderId:     string;
  checkoutUrl?: string;   // Nomod hosted checkout URL
  keyId?:      string;    // Razorpay client-side key (non-secret)
  amount:      number;    // In smallest currency unit (paise/fils)
  currency:    string;
}

export interface RazorpayConfig {
  keyId:     string;
  keySecret: string;
}

export interface NomodConfig {
  apiKey:    string;
  apiSecret: string;
}

export async function createRazorpayOrder(
  config: RazorpayConfig,
  params: { amount: number; currency: string; receipt: string; notes?: Record<string, string> },
): Promise<GatewayOrderResult> {
  const auth = btoa(`${config.keyId}:${config.keySecret}`);

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      amount:   Math.round(params.amount * 100), // paise
      currency: params.currency,
      receipt:  params.receipt,
      notes:    params.notes ?? {},
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Razorpay order creation failed: ${err}`);
  }

  const order = await res.json() as { id: string; amount: number; currency: string };
  return {
    gateway:  "RAZORPAY",
    orderId:  order.id,
    keyId:    config.keyId,
    amount:   order.amount,
    currency: order.currency,
  };
}

export async function createNomodCheckout(
  config: NomodConfig,
  params: { amount: number; currency: string; reference: string; redirectUrl: string; description: string },
): Promise<GatewayOrderResult> {
  const res = await fetch("https://api.nomod.com/v1/checkouts", {
    method: "POST",
    headers: {
      "x-api-key":    config.apiKey,
      "x-api-secret": config.apiSecret,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      amount:      params.amount,
      currency:    params.currency,
      reference:   params.reference,
      redirect_url: params.redirectUrl,
      description: params.description,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Nomod checkout creation failed: ${err}`);
  }

  const checkout = await res.json() as { id: string; checkout_url: string };
  return {
    gateway:     "NOMOD",
    orderId:     checkout.id,
    checkoutUrl: checkout.checkout_url,
    amount:      params.amount,
    currency:    params.currency,
  };
}

export async function createRefundRazorpay(
  config: RazorpayConfig,
  params: { paymentId: string; amount: number; notes?: Record<string, string> },
): Promise<{ refundId: string }> {
  const auth = btoa(`${config.keyId}:${config.keySecret}`);

  const res = await fetch(`https://api.razorpay.com/v1/payments/${params.paymentId}/refund`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(params.amount * 100),
      notes:  params.notes ?? {},
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Razorpay refund failed: ${err}`);
  }

  const refund = await res.json() as { id: string };
  return { refundId: refund.id };
}
