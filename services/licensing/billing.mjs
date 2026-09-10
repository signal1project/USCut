export async function currentSubscription(
  stripe,
  customerId,
  allowedPrices,
  now = Math.floor(Date.now() / 1000),
) {
  if (!stripe || !allowedPrices.size)
    throw new Error('Billing is not configured');
  if (typeof customerId !== 'string' || !customerId.startsWith('cus_'))
    throw new Error('Invalid customer');
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted)
    return { customer: customerId, email: null, entitlement: null };
  if (
    typeof customer.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+$/.test(customer.email)
  )
    throw new Error('Customer email is missing');
  let entitlement = null;
  for await (const sub of stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 100,
  })) {
    if (sub.status !== 'active' || sub.pause_collection) continue;
    for (const item of sub.items?.data || []) {
      const end = item.current_period_end ?? sub.current_period_end;
      if (
        !allowedPrices.has(item.price?.id) ||
        !Number.isSafeInteger(end) ||
        end <= now
      )
        continue;
      if (!entitlement || end > entitlement.periodEndSeconds)
        entitlement = {
          email: customer.email.toLowerCase(),
          customer: customerId,
          plan: item.price.id,
          periodEndSeconds: end,
        };
    }
  }
  return {
    customer: customerId,
    email: customer.email.toLowerCase(),
    entitlement,
  };
}
