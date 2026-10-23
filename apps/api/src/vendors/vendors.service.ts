import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, Vendor, VendorDocument } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { RazorpayGateway, GatewayError } from '../common/razorpay/razorpay.gateway';
import { ApiException, ConflictException, NotFoundException } from '../common/exceptions/api.exception';
import { decryptField, encryptField, last4 } from '../common/crypto/field-encryption';
import { StartOnboardingDto, UpdateOnboardingDto } from './dto/onboarding.dto';
import type { FirebasePrincipal, VendorPrincipal } from '../auth/auth.guard';

/** Documents that must be APPROVED before a vendor can go LIVE. */
export const REQUIRED_DOCUMENTS = ['LICENCE', 'PAN', 'CANCELLED_CHEQUE'] as const;

export interface ActorMeta {
  ip_address?: string;
  user_agent?: string;
}

const SENSITIVE_FIELDS = ['pan', 'bank_account_number', 'ifsc', 'bank_account_holder_name', 'legal_name', 'business_type'] as const;

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly gateway: RazorpayGateway,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // Views — sensitive values are NEVER returned (masked last-4 only)
  // ════════════════════════════════════════════════════════════════════════

  toVendorView(v: Vendor & { documents?: VendorDocument[] }) {
    return {
      id: v.id,
      status: v.status,
      legal_name: v.legal_name,
      display_name: v.display_name,
      description: v.description,
      owner_name: v.owner_name,
      phone: v.phone,
      email: v.email,
      address: v.address,
      address_city: v.address_city,
      address_state: v.address_state,
      address_postal_code: v.address_postal_code,
      business_type: v.business_type,
      licence_number: v.licence_number,
      licence_expiry: v.licence_expiry?.toISOString() ?? null,
      licence_verified: v.licence_verified,
      pan_masked: v.pan_last4 ? `XXXXXX${v.pan_last4}` : null,
      gstin: v.gstin,
      bank_account_masked: v.bank_account_last4 ? `XXXXXXXX${v.bank_account_last4}` : null,
      bank_account_holder_name: v.bank_account_holder_name,
      ifsc: v.ifsc,
      bank_account_verified: v.bank_account_verified,
      razorpay: {
        linked_account_id: v.razorpay_linked_account_id,
        route_product_id: v.razorpay_route_product_id,
        status: v.razorpay_kyc_status,
        onboarded_at: v.razorpay_onboarded_at?.toISOString() ?? null,
      },
      rejection_reason: v.rejection_reason,
      suspension_reason: v.suspension_reason,
      review_notes: v.review_notes,
      reliability_score: v.reliability_score,
      submitted_at: v.submitted_at?.toISOString() ?? null,
      approved_at: v.approved_at?.toISOString() ?? null,
      suspended_at: v.suspended_at?.toISOString() ?? null,
      documents: v.documents?.map((d) => this.toDocumentView(d)),
      onboarding_checklist: this.checklist(v, v.documents ?? []),
    };
  }

  toDocumentView(d: VendorDocument) {
    return {
      id: d.id,
      type: d.type,
      original_name: d.original_name,
      content_type: d.content_type,
      size_bytes: d.size_bytes,
      status: d.status,
      rejection_reason: d.rejection_reason,
      uploaded_at: d.uploaded_at.toISOString(),
      reviewed_at: d.reviewed_at?.toISOString() ?? null,
    };
  }

  checklist(v: Vendor, docs: VendorDocument[]) {
    const has = (type: string, approvedOnly = false) =>
      docs.some((d) => d.type === type && (approvedOnly ? d.status === 'APPROVED' : d.status !== 'REJECTED'));
    const items = {
      business_details: !!(v.legal_name && v.display_name && v.owner_name && v.email && v.address && v.address_city && v.address_state && v.address_postal_code && v.business_type),
      licence: !!(v.licence_number && v.licence_expiry && v.licence_expiry > new Date()),
      pan: !!v.pan,
      bank_details: !!(v.bank_account_number && v.ifsc && v.bank_account_holder_name),
      document_licence: has('LICENCE'),
      document_pan: has('PAN'),
      document_cancelled_cheque: has('CANCELLED_CHEQUE'),
    };
    return {
      items,
      ready_to_submit: Object.values(items).every(Boolean),
      required_documents_approved: REQUIRED_DOCUMENTS.every((t) => has(t, true)),
    };
  }

  private async loadVendor(vendorId: string) {
    const v = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { documents: { orderBy: { uploaded_at: 'desc' } } },
    });
    if (!v) throw new NotFoundException('Vendor');
    return v;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Vendor self-service onboarding
  // ════════════════════════════════════════════════════════════════════════

  async startOnboarding(user: FirebasePrincipal, dto: StartOnboardingDto, meta: ActorMeta) {
    if (!user.phone) {
      throw new ApiException('PHONE_REQUIRED', 'Sign in with a verified phone number to register a company', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const created = await this.prisma.withTransaction(async (tx) => {
      const existing = await tx.vendorMember.findUnique({ where: { firebase_uid: user.firebaseUid } });
      if (existing) {
        throw new ConflictException('ALREADY_A_VENDOR_MEMBER', 'This phone number is already linked to a rafting company', {
          vendor_id: existing.vendor_id,
        });
      }
      const vendor = await tx.vendor.create({
        data: {
          legal_name: dto.legal_name,
          display_name: dto.display_name,
          owner_name: dto.owner_name,
          email: dto.email.toLowerCase(),
          phone: user.phone!,
          address: dto.address,
          business_type: dto.business_type ?? null,
          status: 'DRAFT',
        },
      });
      const member = await tx.vendorMember.create({
        data: { vendor_id: vendor.id, firebase_uid: user.firebaseUid, phone: user.phone!, name: dto.owner_name, role: 'OWNER' },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'VENDOR',
        actor_id: member.id,
        action: 'VENDOR_ONBOARDING_STARTED',
        entity_type: 'Vendor',
        entity_id: vendor.id,
        data: { display_name: vendor.display_name },
        ...meta,
      });
      return vendor;
    });
    return this.toVendorView(await this.loadVendor(created.id));
  }

  async getMine(member: VendorPrincipal) {
    return this.toVendorView(await this.loadVendor(member.vendorId));
  }

  async updateOnboarding(member: VendorPrincipal, dto: UpdateOnboardingDto, meta: ActorMeta) {
    const vendor = await this.loadVendor(member.vendorId);
    const touchedSensitive = SENSITIVE_FIELDS.filter((f) => dto[f] !== undefined);

    if (vendor.status === 'UNDER_REVIEW') {
      throw new ConflictException('UNDER_REVIEW', 'Details are locked while your application is under review');
    }
    if ((vendor.status === 'LIVE' || vendor.status === 'SUSPENDED') && touchedSensitive.length > 0) {
      throw new ConflictException(
        'CONTACT_SUPPORT',
        'Legal, tax and bank details of an approved company can only be changed by RaftNow support (payout safety)',
      );
    }
    if (dto.licence_expiry && new Date(dto.licence_expiry) <= new Date()) {
      throw new ApiException('LICENCE_EXPIRED', 'Licence expiry must be in the future', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const data: Prisma.VendorUpdateInput = {};
    for (const k of ['legal_name', 'display_name', 'description', 'owner_name', 'address', 'address_city', 'address_state', 'address_postal_code', 'business_type', 'gstin', 'ifsc', 'bank_account_holder_name'] as const) {
      if (dto[k] !== undefined) (data as any)[k] = dto[k];
    }
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.licence_number !== undefined || dto.licence_expiry !== undefined) {
      if (dto.licence_number !== undefined) data.licence_number = dto.licence_number;
      if (dto.licence_expiry !== undefined) data.licence_expiry = new Date(dto.licence_expiry);
      data.licence_verified = false; // a changed licence must be re-verified
      data.licence_verified_at = null;
      data.licence_verified_by = null;
    }
    if (dto.pan !== undefined) {
      data.pan = encryptField(dto.pan);
      data.pan_last4 = last4(dto.pan);
    }
    if (dto.bank_account_number !== undefined) {
      data.bank_account_number = encryptField(dto.bank_account_number);
      data.bank_account_last4 = last4(dto.bank_account_number);
    }
    if (dto.bank_account_number !== undefined || dto.ifsc !== undefined || dto.bank_account_holder_name !== undefined) {
      data.bank_account_verified = false;
    }

    await this.prisma.withTransaction(async (tx) => {
      await tx.vendor.update({ where: { id: vendor.id }, data });
      await this.audit.logInTx(tx, {
        actor_type: 'VENDOR',
        actor_id: member.id,
        action: 'VENDOR_DETAILS_UPDATED',
        entity_type: 'Vendor',
        entity_id: vendor.id,
        // Field NAMES only — values (PAN, bank numbers) are never written to the audit log.
        data: { fields: Object.keys(dto).filter((k) => (dto as any)[k] !== undefined) },
        ...meta,
      });
    });
    return this.toVendorView(await this.loadVendor(vendor.id));
  }

  async uploadDocument(
    member: VendorPrincipal,
    type: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
    meta: ActorMeta,
  ) {
    if (!file) throw new ApiException('FILE_REQUIRED', 'Attach the document as multipart field "file"', HttpStatus.BAD_REQUEST);
    const vendor = await this.loadVendor(member.vendorId);
    if (vendor.status === 'UNDER_REVIEW') {
      throw new ConflictException('UNDER_REVIEW', 'Documents are locked while your application is under review');
    }
    const stored = await this.storage.putPrivateDocument(`vendors/${vendor.id}/documents`, file.buffer, file.mimetype);
    const doc = await this.prisma.withTransaction(async (tx) => {
      const d = await tx.vendorDocument.create({
        data: {
          vendor_id: vendor.id,
          type: type as any,
          s3_key: stored.key,
          storage_driver: stored.driver,
          original_name: file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document',
          content_type: stored.contentType,
          size_bytes: stored.size,
          sha256: stored.sha256,
          uploaded_by: member.id,
        },
      });
      if (type === 'LICENCE' && vendor.status === 'LIVE') {
        await tx.vendor.update({ where: { id: vendor.id }, data: { licence_verified: false } });
      }
      await this.audit.logInTx(tx, {
        actor_type: 'VENDOR',
        actor_id: member.id,
        action: 'VENDOR_DOCUMENT_UPLOADED',
        entity_type: 'Vendor',
        entity_id: vendor.id,
        data: { document_id: d.id, type, size_bytes: stored.size, sha256: stored.sha256 },
        ...meta,
      });
      return d;
    });
    return this.toDocumentView(doc);
  }

  async listDocuments(vendorId: string) {
    const docs = await this.prisma.vendorDocument.findMany({ where: { vendor_id: vendorId }, orderBy: { uploaded_at: 'desc' } });
    return docs.map((d) => this.toDocumentView(d));
  }

  /** Short-lived signed URL. Every access is audited. */
  async documentUrl(vendorId: string, documentId: string, actor: { type: 'ADMIN' | 'VENDOR'; id: string } & ActorMeta) {
    const doc = await this.prisma.vendorDocument.findFirst({ where: { id: documentId, vendor_id: vendorId } });
    if (!doc) throw new NotFoundException('Document');
    const signed = await this.storage.signedDownloadUrl(doc.s3_key, doc.storage_driver, doc.original_name, doc.content_type, 300);
    await this.audit.log({
      actor_type: actor.type,
      actor_id: actor.id,
      admin_id: actor.type === 'ADMIN' ? actor.id : undefined,
      action: 'KYC_DOCUMENT_ACCESSED',
      entity_type: 'Vendor',
      entity_id: vendorId,
      data: { document_id: doc.id, type: doc.type },
      ip_address: actor.ip_address,
      user_agent: actor.user_agent,
    });
    return signed;
  }

  async submitForReview(member: VendorPrincipal, meta: ActorMeta) {
    const vendor = await this.loadVendor(member.vendorId);
    if (vendor.status !== 'DRAFT') {
      throw new ConflictException('INVALID_STATUS', `Only DRAFT applications can be submitted (current: ${vendor.status})`);
    }
    const check = this.checklist(vendor, vendor.documents);
    if (!check.ready_to_submit) {
      throw new ApiException('ONBOARDING_INCOMPLETE', 'Complete all onboarding items before submitting', HttpStatus.UNPROCESSABLE_ENTITY, {
        checklist: check.items,
      });
    }
    await this.prisma.withTransaction(async (tx) => {
      const r = await tx.vendor.updateMany({
        where: { id: vendor.id, status: 'DRAFT' },
        data: { status: 'UNDER_REVIEW', submitted_at: new Date(), rejection_reason: null },
      });
      if (r.count !== 1) throw new ConflictException('INVALID_STATUS', 'Application status changed — reload and retry');
      await this.audit.logInTx(tx, {
        actor_type: 'VENDOR',
        actor_id: member.id,
        action: 'VENDOR_SUBMITTED_FOR_REVIEW',
        entity_type: 'Vendor',
        entity_id: vendor.id,
        data: { previous_status: 'DRAFT', new_status: 'UNDER_REVIEW' },
        ...meta,
      });
    });
    return this.toVendorView(await this.loadVendor(vendor.id));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Admin review workflow   DRAFT → UNDER_REVIEW → LIVE ⇄ SUSPENDED
  //                                     └→ DRAFT (rejected, with reason)
  // ════════════════════════════════════════════════════════════════════════

  async adminList(status?: string) {
    const rows = await this.prisma.vendor.findMany({
      where: status ? { status: status as any } : {},
      include: { documents: true, _count: { select: { trips: true } } },
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
      take: 200,
    });
    return rows.map((v) => ({ ...this.toVendorView(v), trip_count: v._count.trips }));
  }

  async adminGet(vendorId: string) {
    const v = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        documents: { orderBy: { uploaded_at: 'desc' } },
        members: { select: { id: true, name: true, phone: true, role: true, active: true } },
        commissions: { orderBy: { effective_from: 'desc' }, take: 5 },
      },
    });
    if (!v) throw new NotFoundException('Vendor');
    return { ...this.toVendorView(v), members: v.members, commissions: v.commissions };
  }

  async reviewDocument(adminId: string, vendorId: string, documentId: string, decision: 'APPROVED' | 'REJECTED', reason: string | undefined, meta: ActorMeta) {
    if (decision === 'REJECTED' && !reason) {
      throw new ApiException('REASON_REQUIRED', 'A rejection reason is required', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return this.prisma.withTransaction(async (tx) => {
      const doc = await tx.vendorDocument.findFirst({ where: { id: documentId, vendor_id: vendorId } });
      if (!doc) throw new NotFoundException('Document');
      const updated = await tx.vendorDocument.update({
        where: { id: doc.id },
        data: { status: decision, reviewed_by: adminId, reviewed_at: new Date(), rejection_reason: decision === 'REJECTED' ? reason : null },
      });
      if (doc.type === 'LICENCE' && decision === 'APPROVED') {
        await tx.vendor.update({
          where: { id: vendorId },
          data: { licence_verified: true, licence_verified_at: new Date(), licence_verified_by: adminId },
        });
      }
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: adminId,
        admin_id: adminId,
        action: `VENDOR_DOCUMENT_${decision}`,
        entity_type: 'Vendor',
        entity_id: vendorId,
        data: { document_id: doc.id, type: doc.type, previous_status: doc.status, new_status: decision, reason },
        ...meta,
      });
      return this.toDocumentView(updated);
    });
  }

  private async transition(
    adminId: string,
    vendorId: string,
    from: Array<Vendor['status']>,
    to: Vendor['status'],
    action: string,
    extra: Prisma.VendorUpdateInput,
    reason: string | undefined,
    meta: ActorMeta,
    guard?: (v: Vendor & { documents: VendorDocument[] }) => void,
  ) {
    await this.prisma.withTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vendors WHERE id = ${vendorId}::uuid FOR UPDATE`;
      const v = await tx.vendor.findUnique({ where: { id: vendorId }, include: { documents: true } });
      if (!v) throw new NotFoundException('Vendor');
      if (!from.includes(v.status)) {
        throw new ConflictException('INVALID_STATUS', `Cannot move vendor from ${v.status} to ${to}`);
      }
      guard?.(v);
      await tx.vendor.update({ where: { id: vendorId }, data: { status: to, reviewed_by: adminId, ...extra } });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: adminId,
        admin_id: adminId,
        action,
        entity_type: 'Vendor',
        entity_id: vendorId,
        data: { previous_status: v.status, new_status: to, reason },
        ...meta,
      });
      await this.notifications.notifyVendorInTx(tx, vendorId, 'VENDOR_STATUS_CHANGED', { status: to, reason: reason ?? null }, `${action}:${Date.now()}`, ['EMAIL', 'SMS']);
    });
    return this.adminGet(vendorId);
  }

  async approve(adminId: string, vendorId: string, notes: string | undefined, meta: ActorMeta) {
    await this.transition(
      adminId,
      vendorId,
      ['UNDER_REVIEW'],
      'LIVE',
      'VENDOR_APPROVED',
      {
        approved_at: new Date(),
        review_notes: notes ?? null,
        rejection_reason: null,
        licence_verified: true,
        licence_verified_at: new Date(),
        licence_verified_by: adminId,
        bank_account_verified: true,
      },
      notes,
      meta,
      (v) => {
        const check = this.checklist(v, v.documents);
        if (!check.ready_to_submit || !check.required_documents_approved) {
          throw new ApiException('KYC_INCOMPLETE', 'All required documents must be APPROVED and details complete', HttpStatus.UNPROCESSABLE_ENTITY, {
            checklist: check,
          });
        }
      },
    );
    // Commission is configured explicitly per vendor; seed a default if none exists.
    const existing = await this.prisma.vendorCommission.count({ where: { vendor_id: vendorId } });
    if (existing === 0) {
      await this.prisma.vendorCommission.create({
        data: {
          vendor_id: vendorId,
          commission_bps: parseInt(process.env.DEFAULT_COMMISSION_BPS ?? '1000', 10),
          effective_from: new Date(),
          set_by_admin: adminId,
        },
      });
    }
    return this.adminGet(vendorId);
  }

  reject(adminId: string, vendorId: string, reason: string, meta: ActorMeta) {
    return this.transition(adminId, vendorId, ['UNDER_REVIEW'], 'DRAFT', 'VENDOR_REJECTED', { rejection_reason: reason }, reason, meta);
  }

  suspend(adminId: string, vendorId: string, reason: string, meta: ActorMeta) {
    return this.transition(adminId, vendorId, ['LIVE'], 'SUSPENDED', 'VENDOR_SUSPENDED', { suspended_at: new Date(), suspension_reason: reason }, reason, meta);
  }

  reinstate(adminId: string, vendorId: string, reason: string, meta: ActorMeta) {
    return this.transition(adminId, vendorId, ['SUSPENDED'], 'LIVE', 'VENDOR_REINSTATED', { suspended_at: null, suspension_reason: null }, reason, meta, (v) => {
      if (!v.licence_expiry || v.licence_expiry <= new Date() || !v.licence_verified) {
        throw new ApiException('LICENCE_INVALID', 'A valid, verified licence is required to reinstate', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    });
  }

  async setCommission(adminId: string, vendorId: string, bps: number, meta: ActorMeta) {
    await this.prisma.withTransaction(async (tx) => {
      const v = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!v) throw new NotFoundException('Vendor');
      const now = new Date();
      const prev = await tx.vendorCommission.findFirst({ where: { vendor_id: vendorId, effective_to: null }, orderBy: { effective_from: 'desc' } });
      await tx.vendorCommission.updateMany({ where: { vendor_id: vendorId, effective_to: null }, data: { effective_to: now } });
      await tx.vendorCommission.create({ data: { vendor_id: vendorId, commission_bps: bps, effective_from: now, set_by_admin: adminId } });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: adminId,
        admin_id: adminId,
        action: 'VENDOR_COMMISSION_SET',
        entity_type: 'Vendor',
        entity_id: vendorId,
        data: { previous_bps: prev?.commission_bps ?? null, new_bps: bps },
        ...meta,
      });
    });
    return this.adminGet(vendorId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Razorpay Route linked-account onboarding (admin, after KYC approval)
  // Resumable: each step stores its gateway ID, so a retry continues where it
  // stopped and never creates a second linked account.
  // ════════════════════════════════════════════════════════════════════════

  async onboardRouteAccount(adminId: string, vendorId: string, meta: ActorMeta) {
    if (!this.gateway.isConfigured()) {
      throw new ApiException('PAYMENTS_NOT_CONFIGURED', 'Razorpay credentials are not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const v = await this.loadVendor(vendorId);
    if (v.status !== 'LIVE') throw new ConflictException('INVALID_STATUS', 'Approve the vendor before creating a Route account');
    if (!v.pan || !v.bank_account_number || !v.ifsc || !v.bank_account_holder_name || !v.business_type || !v.address_city || !v.address_state || !v.address_postal_code) {
      throw new ApiException('KYC_INCOMPLETE', 'Business type, structured address, PAN and bank details are required', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const pan = decryptField(v.pan);
    const steps: string[] = [];

    const step = async (name: string, fn: () => Promise<Prisma.VendorUpdateInput>) => {
      try {
        const data = await fn();
        await this.prisma.vendor.update({ where: { id: vendorId }, data });
        steps.push(name);
      } catch (err) {
        const g = err as GatewayError;
        await this.audit.log({
          actor_type: 'ADMIN',
          actor_id: adminId,
          admin_id: adminId,
          action: 'ROUTE_ONBOARDING_STEP_FAILED',
          entity_type: 'Vendor',
          entity_id: vendorId,
          data: { step: name, status: g.statusCode, code: g.code, message: g.message },
          ...meta,
        });
        throw new ApiException('ROUTE_ONBOARDING_FAILED', `Razorpay rejected step "${name}": ${g.message}`, HttpStatus.BAD_GATEWAY, {
          step: name,
          completed_steps: steps,
          gateway_code: g.code,
        });
      }
    };

    let accountId = v.razorpay_linked_account_id;
    if (!accountId) {
      await step('create_linked_account', async () => {
        const acc: any = await this.gateway.createLinkedAccount({
          email: v.email,
          phone: v.phone.replace(/^\+91/, ''),
          type: 'route',
          reference_id: v.id.replace(/-/g, '').slice(0, 20),
          legal_business_name: v.legal_name,
          business_type: v.business_type,
          contact_name: v.owner_name,
          profile: {
            category: 'tours_and_travel',
            subcategory: 'travel_agency',
            addresses: {
              registered: {
                street1: v.address.slice(0, 100),
                street2: v.address.slice(100, 200) || v.address_city,
                city: v.address_city,
                state: v.address_state,
                postal_code: v.address_postal_code,
                country: 'IN',
              },
            },
          },
          legal_info: { pan, ...(v.gstin ? { gst: v.gstin } : {}) },
        });
        accountId = acc.id;
        return { razorpay_linked_account_id: acc.id, razorpay_kyc_status: acc.status ?? 'created' };
      });
    }
    if (!v.razorpay_stakeholder_id) {
      await step('create_stakeholder', async () => {
        const sth: any = await this.gateway.createStakeholder(accountId!, {
          name: v.owner_name,
          email: v.email,
          kyc: { pan },
        });
        return { razorpay_stakeholder_id: sth.id };
      });
    }
    let productId = v.razorpay_route_product_id;
    if (!productId) {
      await step('request_route_product', async () => {
        const prd: any = await this.gateway.requestRouteProduct(accountId!);
        productId = prd.id;
        return { razorpay_route_product_id: prd.id, razorpay_kyc_status: prd.activation_status ?? 'requested' };
      });
    }
    await step('configure_settlement_account', async () => {
      const prd: any = await this.gateway.updateRouteProduct(accountId!, productId!, {
        settlements: {
          account_number: decryptField(v.bank_account_number!),
          ifsc_code: v.ifsc,
          beneficiary_name: v.bank_account_holder_name,
        },
        tnc_accepted: true,
      });
      const status = prd.activation_status ?? 'under_review';
      return { razorpay_kyc_status: status, ...(status === 'activated' ? { razorpay_onboarded_at: new Date() } : {}) };
    });

    await this.audit.log({
      actor_type: 'ADMIN',
      actor_id: adminId,
      admin_id: adminId,
      action: 'ROUTE_ACCOUNT_ONBOARDED',
      entity_type: 'Vendor',
      entity_id: vendorId,
      data: { linked_account_id: accountId, route_product_id: productId, steps },
      ...meta,
    });
    return this.adminGet(vendorId);
  }

  async syncRouteStatus(vendorId: string) {
    const v = await this.loadVendor(vendorId);
    if (!v.razorpay_linked_account_id || !v.razorpay_route_product_id) {
      throw new ConflictException('NOT_ONBOARDED', 'This vendor has no Route account yet');
    }
    const prd: any = await this.gateway.fetchRouteProduct(v.razorpay_linked_account_id, v.razorpay_route_product_id);
    const status = prd?.activation_status ?? v.razorpay_kyc_status;
    await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        razorpay_kyc_status: status,
        ...(status === 'activated' && !v.razorpay_onboarded_at ? { razorpay_onboarded_at: new Date() } : {}),
      },
    });
    return { linked_account_id: v.razorpay_linked_account_id, status, requirements: prd?.requirements ?? [] };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Licence expiry (daily job)
  // ════════════════════════════════════════════════════════════════════════

  async handleLicenceExpiry() {
    const now = new Date();
    const expired = await this.prisma.vendor.findMany({
      where: { status: 'LIVE', licence_expiry: { lt: now } },
      select: { id: true, licence_expiry: true },
    });
    for (const v of expired) {
      await this.prisma.withTransaction(async (tx) => {
        const r = await tx.vendor.updateMany({
          where: { id: v.id, status: 'LIVE' },
          data: { status: 'SUSPENDED', suspended_at: now, suspension_reason: 'LICENCE_EXPIRED', licence_verified: false },
        });
        if (r.count !== 1) return;
        await this.audit.logInTx(tx, {
          actor_type: 'SYSTEM',
          action: 'VENDOR_SUSPENDED_LICENCE_EXPIRED',
          entity_type: 'Vendor',
          entity_id: v.id,
          data: { previous_status: 'LIVE', new_status: 'SUSPENDED', licence_expiry: v.licence_expiry?.toISOString() },
        });
        await this.notifications.notifyVendorInTx(tx, v.id, 'LICENCE_EXPIRED', {}, `expired:${v.licence_expiry?.toISOString()}`, ['EMAIL', 'SMS']);
      });
    }

    let reminders = 0;
    for (const days of [30, 7]) {
      const soon = await this.prisma.vendor.findMany({
        where: { status: 'LIVE', licence_expiry: { gte: now, lt: new Date(now.getTime() + days * 86_400_000) } },
        select: { id: true, licence_expiry: true },
      });
      for (const v of soon) {
        await this.notifications.notifyVendorInTx(
          this.prisma,
          v.id,
          'LICENCE_EXPIRING',
          { expiry_date: v.licence_expiry!.toISOString().slice(0, 10) },
          `${days}d:${v.licence_expiry!.toISOString().slice(0, 10)}`,
          ['EMAIL', 'SMS'],
        );
        reminders++;
      }
    }
    if (expired.length) this.logger.warn(`Suspended ${expired.length} vendors with expired licences`);
    return { suspended: expired.length, reminders };
  }
}
