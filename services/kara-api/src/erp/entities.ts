/** The connector's objects as Kara serves them. */
export interface ErpEntity {
  name: 'partner' | 'product' | 'employee' | 'sale_order';
  /** The collection in the connector's and in kara-api's URLs. */
  collection: string;
  topic: string;
  /** A record with no company belongs to every company (partners, products). */
  sharedWithoutCompany: boolean;
  /** Kara may create these through the connector. */
  creatable: boolean;
  /** Fields searched by ?q= besides the name. */
  searchFields: string[];
}

export const ENTITIES: ErpEntity[] = [
  { name: 'partner', collection: 'partners', topic: 'erp.partner.v1', sharedWithoutCompany: true, creatable: true, searchFields: ['email', 'vat', 'phone'] },
  { name: 'product', collection: 'products', topic: 'erp.product.v1', sharedWithoutCompany: true, creatable: true, searchFields: ['code', 'barcode'] },
  { name: 'employee', collection: 'employees', topic: 'erp.employee.v1', sharedWithoutCompany: false, creatable: false, searchFields: ['workEmail', 'jobTitle'] },
  { name: 'sale_order', collection: 'sale-orders', topic: 'erp.sale_order.v1', sharedWithoutCompany: false, creatable: false, searchFields: ['number', 'customerReference'] },
];

export const byCollection = new Map(ENTITIES.map(e => [e.collection, e]));
export const byTopic = new Map(ENTITIES.map(e => [e.topic, e]));

/** The display name of an object: sale orders have a number, the rest a name. */
export const nameOf = (data: Record<string, unknown>) => String(data.name ?? data.number ?? '');

export const companyOf = (data: Record<string, unknown>): number | null => {
  const c = data.company as { id?: unknown } | null | undefined;
  return typeof c?.id === 'number' ? c.id : null;
};
