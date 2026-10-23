// Vendor-related shared types
export interface VendorPublicDto {
  id: string;
  display_name: string;
  description: string | null;
  logo_url: string | null;
  licence_number: string;
  licence_expiry: string;
  licence_verified: boolean;
  status: string;
  rating: number | null;
  total_bookings: number;
}

export interface VendorProfileDto extends VendorPublicDto {
  legal_name: string;
  owner_name: string;
  address: string;
  phone: string;
  email: string;
  pan: string | null;
  gstin: string | null;
  bank_account_last4: string | null;
  ifsc: string | null;
  razorpay_linked_account_id: string | null;
  commission_bps: number;
}

export interface VendorOnboardingDto {
  legal_name: string;
  display_name: string;
  owner_name: string;
  phone: string;
  email: string;
  address: string;
  licence_number: string;
  licence_expiry: string;
  description?: string;
}
