import {
  CustomPastryOrder,
  CustomPrepaymentReviewStatus,
  Invoice,
  InvoiceItem,
  InvoicePayment,
  InvoicePaymentMethod,
  InvoiceStatus,
  Order,
} from '../types';

/**
 * Keeps legacy custom orders usable after the prepayment review workflow was
 * introduced. Old records only know `isPrepaymentPaid`, while new records
 * retain the full lifecycle of a submitted receipt.
 */
export function getCustomPrepaymentStatus(order: Pick<CustomPastryOrder,
  'prepaymentStatus' | 'isPrepaymentPaid' | 'paymentReceiptImage' | 'prepaymentAmount'
>): CustomPrepaymentReviewStatus {
  if (order.prepaymentStatus) return order.prepaymentStatus;
  if (order.isPrepaymentPaid) return 'approved';
  if (order.paymentReceiptImage) return 'pending_confirmation';
  if (order.prepaymentAmount && order.prepaymentAmount > 0) return 'awaiting_receipt';
  return 'not_required';
}

export const customPrepaymentStatusLabels: Record<CustomPrepaymentReviewStatus, string> = {
  not_required: 'بیعانه لازم نیست / پرداخت هنگام تحویل',
  awaiting_receipt: 'در انتظار پرداخت / ارسال فیش بیعانه',
  pending_confirmation: 'فیش بیعانه در انتظار تأیید ادمین',
  approved: 'بیعانه تأیید شده',
  rejected: 'فیش بیعانه رد شده',
};

export function isCustomPrepaymentVerified(order: Pick<CustomPastryOrder,
  'prepaymentStatus' | 'isPrepaymentPaid' | 'paymentReceiptImage' | 'prepaymentAmount'
>) {
  const status = getCustomPrepaymentStatus(order);
  return status === 'approved' || status === 'not_required';
}

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: 'پیش‌نویس',
  issued: 'صادر شده',
  pending_payment: 'در انتظار پرداخت',
  payment_review: 'در انتظار تأیید پرداخت',
  partially_paid: 'بخشی پرداخت شده',
  paid: 'تسویه شده',
  overdue: 'سررسید گذشته',
  cancelled: 'لغو شده',
  refunded: 'مسترد شده',
};

export const invoicePaymentStatusLabels: Record<InvoicePayment['status'], string> = {
  pending: 'در انتظار پرداخت',
  submitted: 'فیش ارسال شده / در بررسی',
  confirmed: 'تأیید شده',
  rejected: 'رد شده',
  refunded: 'مسترد شده',
};

export const invoicePaymentMethodLabels: Record<InvoicePaymentMethod, string> = {
  cash: 'نقدی',
  cash_on_delivery: 'پرداخت هنگام تحویل',
  card_to_card: 'کارت‌به‌کارت',
  online_payment: 'پرداخت آنلاین',
  online_gateway: 'درگاه پرداخت',
  bank_transfer: 'حواله بانکی',
  wallet: 'کیف پول',
  other: 'سایر',
};

export const invoiceSourceLabels: Record<Invoice['source'], string> = {
  regular_order: 'سفارش عادی',
  custom_order: 'سفارش سفارشی',
  manual: 'فاکتور دستی',
};

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function calculateInvoiceAmounts(input: Pick<Invoice, 'items' | 'shippingFee' | 'discountAmount' | 'taxAmount' | 'payments'>) {
  const subtotal = (input.items || []).reduce((sum, item) => sum + amount(item.totalAmount), 0);
  const shippingFee = roundNonNegative(input.shippingFee);
  const discountAmount = roundNonNegative(input.discountAmount);
  const taxAmount = roundNonNegative(input.taxAmount);
  const totalAmount = Math.max(0, subtotal + shippingFee + taxAmount - discountAmount);
  const paidAmount = (input.payments || [])
    .filter(payment => payment.status === 'confirmed')
    .reduce((sum, payment) => sum + amount(payment.amount), 0);

  return {
    subtotal,
    shippingFee,
    discountAmount,
    taxAmount,
    totalAmount,
    paidAmount,
    remainingAmount: Math.max(0, totalAmount - paidAmount),
  };
}

export function resolveManualInvoiceStatus(
  requestedStatus: InvoiceStatus,
  amounts: Pick<Invoice, 'totalAmount' | 'paidAmount' | 'payments'>,
): InvoiceStatus {
  if (requestedStatus === 'draft' || requestedStatus === 'cancelled' || requestedStatus === 'refunded') {
    return requestedStatus;
  }
  if (amounts.totalAmount > 0 && amounts.paidAmount >= amounts.totalAmount) return 'paid';
  if (amounts.paidAmount > 0) return 'partially_paid';
  if (amounts.payments.some(payment => payment.status === 'submitted')) return 'payment_review';
  return requestedStatus === 'issued' ? 'issued' : 'pending_payment';
}

function orderPaymentMethod(method: Order['paymentMethod']): InvoicePaymentMethod {
  if (method === 'cash_on_delivery') return 'cash_on_delivery';
  if (method === 'card_to_card') return 'card_to_card';
  if (method === 'online_gateway') return 'online_gateway';
  return 'online_payment';
}

function orderPaymentStatus(order: Order): InvoicePayment['status'] {
  if (order.paymentMethod === 'cash_on_delivery') {
    return order.status === 'delivered' ? 'confirmed' : 'pending';
  }
  // A verified receipt is a financial confirmation, not an instruction to
  // start production. Keep those two parts of the workflow independent.
  if (order.receiptReviewStatus === 'confirmed' || ['receipt_confirmed', 'baking', 'shipped', 'delivered'].includes(order.status)) return 'confirmed';
  // Retain a rejected image for the admin's audit trail, but do not keep the
  // related invoice in the "awaiting review" queue.
  if (order.receiptReviewStatus === 'rejected') return 'rejected';
  if (order.paymentReceiptImage || order.status === 'paid_checking') return 'submitted';
  return 'pending';
}

export function buildOrderInvoice(order: Order): Invoice {
  const paymentStatus = orderPaymentStatus(order);
  const payment: InvoicePayment = {
    id: `payment-order-${order.id}`,
    amount: order.totalAmount,
    method: orderPaymentMethod(order.paymentMethod),
    status: paymentStatus,
    receiptImage: order.paymentReceiptImage,
    createdAt: order.updatedAt || order.createdAt,
    paidAt: paymentStatus === 'confirmed' ? order.updatedAt : undefined,
  };
  const items: InvoiceItem[] = order.items.map((item, index) => ({
    id: `line-order-${order.id}-${index}`,
    title: item.productName,
    productCode: item.productCode,
    quantity: positiveNumber(item.quantity),
    unit: item.unit,
    unitPrice: amount(item.price),
    discountAmount: 0,
    totalAmount: Math.round(amount(item.price) * positiveNumber(item.quantity)),
  }));
  const paidAmount = paymentStatus === 'confirmed' ? amount(order.totalAmount) : 0;
  const status: InvoiceStatus = paidAmount >= amount(order.totalAmount) && amount(order.totalAmount) > 0
    ? 'paid'
    : paymentStatus === 'submitted'
      ? 'payment_review'
      : 'pending_payment';

  return {
    id: `invoice-order-${order.id}`,
    invoiceNumber: `INV-${order.orderNumber}`,
    source: 'regular_order',
    sourceId: order.id,
    relatedOrderNumber: order.orderNumber,
    title: 'فاکتور سفارش عادی',
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerTelegramId: order.customerTelegramId,
    customerAddress: order.customerAddress,
    items,
    subtotal: amount(order.subtotal) || items.reduce((sum, item) => sum + item.totalAmount, 0),
    discountAmount: amount(order.discountAmount),
    shippingFee: amount(order.shippingFee),
    taxAmount: 0,
    totalAmount: amount(order.totalAmount),
    paidAmount,
    remainingAmount: Math.max(0, amount(order.totalAmount) - paidAmount),
    status,
    paymentMethod: orderPaymentMethod(order.paymentMethod),
    payments: [payment],
    deliveryMethod: order.deliveryMethod,
    deliveryAddress: order.customerAddress,
    notes: [
      order.couponCode ? `کد تخفیف: ${order.couponCode}` : '',
      order.receiptReviewReason ? `علت رد فیش: ${order.receiptReviewReason}` : '',
      order.notes || '',
    ].filter(Boolean).join(' • ') || undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function buildCustomOrderInvoice(order: CustomPastryOrder): Invoice {
  const totalAmount = amount(order.finalPrice || order.estimatedPrice);
  const prepaymentAmount = amount(order.prepaymentAmount);
  const prepaymentStatus = getCustomPrepaymentStatus(order);
  const paymentStatus: InvoicePayment['status'] = prepaymentStatus === 'approved'
    ? 'confirmed'
    : prepaymentStatus === 'pending_confirmation'
      ? 'submitted'
      : prepaymentStatus === 'rejected'
        ? 'rejected'
        : 'pending';
  const paymentMethod: InvoicePaymentMethod = order.paymentMethod === 'cash_on_delivery'
    ? 'cash_on_delivery'
    : 'card_to_card';
  const hasPrepayment = prepaymentAmount > 0 || Boolean(order.paymentReceiptImage);
  const payments: InvoicePayment[] = hasPrepayment ? [{
    id: `payment-custom-${order.id}`,
    amount: prepaymentAmount,
    method: paymentMethod,
    status: paymentStatus,
    receiptImage: order.paymentReceiptImage,
    notes: 'بیعانه سفارش سفارشی',
    createdAt: order.prepaymentSubmittedAt || order.updatedAt || order.createdAt,
    paidAt: paymentStatus === 'confirmed' ? order.prepaymentReviewedAt || order.updatedAt : undefined,
  }] : [];
  const paidAmount = paymentStatus === 'confirmed' ? prepaymentAmount : 0;
  const status: InvoiceStatus = order.status === 'rejected'
    ? 'cancelled'
    : totalAmount > 0 && paidAmount >= totalAmount
      ? 'paid'
      : paidAmount > 0
        ? 'partially_paid'
        : paymentStatus === 'submitted'
          ? 'payment_review'
          : 'pending_payment';
  const deliveryTime = [order.deliveryDate, order.deliveryTimeSlot].filter(Boolean).join(' • ');

  return {
    id: `invoice-custom-${order.id}`,
    invoiceNumber: `INV-${order.orderNumber}`,
    source: 'custom_order',
    sourceId: order.id,
    relatedOrderNumber: order.orderNumber,
    title: 'فاکتور سفارش سفارشی',
    customerName: order.customerName || order.customerTelegramName || 'مشتری سفارش سفارشی',
    customerPhone: order.customerPhone,
    customerTelegramId: order.customerTelegramId,
    customerAddress: order.deliveryAddress,
    items: [{
      id: `line-custom-${order.id}`,
      title: order.pastryType,
      description: [order.shapeAndDesign, order.weightKg ? `${order.weightKg} کیلوگرم` : '', order.servingCount ? `${order.servingCount} نفر` : ''].filter(Boolean).join(' • '),
      quantity: 1,
      unit: 'سفارش',
      unitPrice: totalAmount,
      discountAmount: 0,
      totalAmount,
    }],
    subtotal: totalAmount,
    discountAmount: 0,
    shippingFee: 0,
    taxAmount: 0,
    totalAmount,
    paidAmount,
    remainingAmount: Math.max(0, totalAmount - paidAmount),
    status,
    paymentMethod,
    payments,
    deliveryMethod: order.deliveryType,
    deliveryAddress: order.deliveryAddress,
    notes: [deliveryTime ? `زمان درخواستی تحویل: ${deliveryTime}` : '', order.prepaymentRejectReason ? `علت رد فیش: ${order.prepaymentRejectReason}` : '', order.adminNotes || ''].filter(Boolean).join(' • ') || undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function sortInvoicesByRecent(invoices: Invoice[]) {
  return [...invoices].sort((first, second) => {
    const firstDate = Date.parse(first.updatedAt || first.createdAt || '') || 0;
    const secondDate = Date.parse(second.updatedAt || second.createdAt || '') || 0;
    return secondDate - firstDate;
  });
}

export function buildAllInvoices(orders: Order[], customOrders: CustomPastryOrder[], manualInvoices: Invoice[]) {
  return sortInvoicesByRecent([
    ...orders.map(buildOrderInvoice),
    ...customOrders.map(buildCustomOrderInvoice),
    ...manualInvoices.filter((invoice) => invoice?.source === 'manual'),
  ]);
}
