export interface NewCompany {
  companyID?: number;
  name: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode?: string;
  phone?: string;
  email?: string;
  logoPath?: string;
  invoicePrefix?: string;
  nextInvoiceNo?: number;
}

export interface Item {
  productID?: number;
  itemNumber: string;
  barcode?: string;
  itemName: string;
  description?: string;
  hsnCode?: string;
  gstRate: number;
  unit: string;
  unitPrice: number;
  discount: number;
  reorderLevel: number;
  imageURL?: string;
  status?: string;
  totalStock?: number;
}

export interface Vendor {
  vendorID?: number;
  fullName: string;
  gstin?: string;
  email?: string;
  mobile: string;
  phone2?: string;
  address: string;
  address2?: string;
  city?: string;
  district?: string;
  state: string;
  pincode?: string;
  status?: string;
}

export interface Customer {
  customerID?: number;
  fullName: string;
  gstin?: string;
  mobile?: string;
  address?: string;
  state?: string;
  customerType?: string;
  status?: string;
}

export interface InvoiceLineDto {
  // Request
  productID: number;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  // Response
  invoiceItemID?: number;
  batchID?: number;
  itemName?: string;
  batchNo?: string;
  expiryDate?: string;
  hsnCode?: string;
  gstRate?: number;
  taxableValue?: number;
  taxAmount?: number;
  lineTotal?: number;
}

export interface Invoice {
  // Request
  customerID?: number;
  customerName?: string;
  customerGstin?: string;
  customerMobile?: string;
  customerState?: string;
  paymentMode?: string;
  createdBy?: number;
  items?: InvoiceLineDto[];
  // Response
  invoiceID?: number;
  invoiceNo?: string;
  invoiceDate?: string;
  placeOfSupply?: string;
  subTotal?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  roundOff?: number;
  grandTotal?: number;
  status?: string;
}