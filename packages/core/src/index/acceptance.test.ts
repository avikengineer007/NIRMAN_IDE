import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RepoIndex } from './repo-index.js';
import { ContextManager } from '../context/context-manager.js';
import { LocalSandbox } from '@nirman/sandbox';
import { estimateMessagesTokens } from '@nirman/model';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Step 6 Acceptance: 200+ File Repo Indexing & Context Assembly', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;
  let repoIndex: RepoIndex;

  // 10 Domains x 20 Files = 200 files + 5 root files = 205 files
  const domains = [
    {
      name: 'auth',
      files: [
        ['jwt-service.ts', 'export class JwtService { signToken(user: string): string { return "token"; } rotateRefreshToken(token: string): string { return "refreshed"; } }'],
        ['password-hasher.ts', 'export function hashPassword(plain: string): string { return "hash"; } export function verifyPassword(plain: string, hash: string): boolean { return true; }'],
        ['session-store.ts', 'export interface Session { id: string; expires: number; } export class SessionStore { get(id: string) {} save(s: Session) {} }'],
        ['oauth-google.ts', 'export function authenticateGoogle(code: string) { return { email: "user@google.com" }; }'],
        ['oauth-github.ts', 'export function authenticateGithub(code: string) { return { username: "octocat" }; }'],
        ['role-permission.ts', 'export enum Role { ADMIN, USER, GUEST } export function checkPermission(r: Role, p: string): boolean { return true; }'],
        ['mfa-totp.ts', 'export function verifyTotpToken(secret: string, token: string): boolean { return token.length === 6; }'],
        ['rate-limiter.ts', 'export class RateLimiter { isAllowed(ip: string): boolean { return true; } }'],
        ['token-blacklist.ts', 'export class TokenBlacklist { revoke(token: string) {} isRevoked(t: string): boolean { return false; } }'],
        ['api-keys.ts', 'export function validateApiKey(key: string): boolean { return key.startsWith("key_"); }'],
        ['auth-guard.ts', 'export function requireAuth(req: any) { if (!req.headers.authorization) throw new Error("Unauthorized"); }'],
        ['login-throttler.ts', 'export class LoginThrottler { trackAttempt(ip: string) {} isLocked(ip: string) { return false; } }'],
        ['device-fingerprint.ts', 'export function getFingerprint(headers: any): string { return "fp_123"; }'],
        ['csrf-protection.ts', 'export function verifyCsrfToken(reqToken: string, sessionToken: string): boolean { return reqToken === sessionToken; }'],
        ['magic-link.ts', 'export function generateMagicLink(email: string): string { return "https://app/login?code=123"; }'],
        ['saml-sso.ts', 'export class SamlSsoClient { validateResponse(xml: string) { return { email: "sso@company.com" }; } }'],
        ['rbac-matrix.ts', 'export const RBAC_PERMISSIONS = { admin: ["read", "write", "delete"], user: ["read", "write"] };'],
        ['audit-logger.ts', 'export function logAuthEvent(event: string, user: string) { console.log(event, user); }'],
        ['password-policy.ts', 'export function validatePasswordStrength(p: string): boolean { return p.length >= 8; }'],
        ['token-claims.ts', 'export interface TokenClaims { sub: string; role: string; iss: string; exp: number; }'],
      ],
    },
    {
      name: 'billing',
      files: [
        ['stripe-client.ts', 'export class StripeClient { createCharge(amount: number) { return { id: "ch_123", amount }; } }'],
        ['payment-webhook.ts', 'export function handleStripeWebhook(event: string, payload: any) { if (event === "invoice.payment_failed") return { status: "failed", retry: true }; return { status: "ok" }; }'],
        ['invoice-generator.ts', 'export function createInvoice(customer: string, items: any[]): string { return "INV-001"; }'],
        ['subscription-plan.ts', 'export interface SubscriptionPlan { id: string; priceMonthly: number; features: string[]; }'],
        ['tax-calculator.ts', 'export function calculateVatTax(amount: number, countryCode: string): number { return amount * 0.2; }'],
        ['currency-exchange.ts', 'export function convertCurrency(amount: number, from: string, to: string): number { return amount * 1.08; }'],
        ['refund-handler.ts', 'export function processRefund(chargeId: string, amount: number) { return { refundId: "ref_123", amount }; }'],
        ['coupon-code.ts', 'export function applyCoupon(code: string, subtotal: number): number { return subtotal * 0.9; }'],
        ['credit-balance.ts', 'export class CustomerCreditBalance { getCredit(cId: string): number { return 50.0; } addCredit(cId: string, amt: number) {} }'],
        ['usage-meter.ts', 'export class UsageMeter { recordComputeMinutes(customerId: string, minutes: number) {} }'],
        ['billing-portal.ts', 'export function getCustomerPortalUrl(customerId: string): string { return "https://billing.stripe.com/p/session_123"; }'],
        ['pricing-tiers.ts', 'export const PRICING_TIERS = { free: 0, pro: 29, enterprise: 299 };'],
        ['payment-methods.ts', 'export function attachPaymentMethod(cardId: string, customerId: string) { return true; }'],
        ['dunning-manager.ts', 'export class DunningManager { retryFailedInvoice(invoiceId: string) { return true; } }'],
        ['receipt-email.ts', 'export function sendPaymentReceipt(email: string, invoice: string) {}'],
        ['ledger-journal.ts', 'export function recordJournalEntry(debit: string, credit: string, amount: number) {}'],
        ['tax-exemptions.ts', 'export function isTaxExempt(customerId: string): boolean { return false; }'],
        ['proration-calc.ts', 'export function calculateProration(daysUsed: number, daysInMonth: number, planPrice: number): number { return (daysUsed / daysInMonth) * planPrice; }'],
        ['crypto-payment.ts', 'export function acceptUsdcPayment(wallet: string, amount: number) { return "tx_usdc_123"; }'],
        ['b2b-net30.ts', 'export function createNet30Invoice(companyId: string, terms: string) { return "NET30-INV"; }'],
      ],
    },
    {
      name: 'database',
      files: [
        ['query-builder.ts', 'export class QueryBuilder { select(cols: string[]) { return this; } where(condition: string, param: any) { return this; } buildSafeSql(): string { return "SELECT * FROM users WHERE id = ?"; } }'],
        ['connection-pool.ts', 'export class ConnectionPool { getConnection() { return { query: () => [] }; } releaseConnection(c: any) {} }'],
        ['migration-runner.ts', 'export class MigrationRunner { async up(migrationsDir: string) { return ["001_init.sql"]; } }'],
        ['transaction-manager.ts', 'export async function withTransaction(fn: (tx: any) => Promise<any>) { return fn({}); }'],
        ['redis-cache.ts', 'export class RedisCache { get(key: string) { return null; } set(key: string, val: string, ttl: number) {} }'],
        ['schema-validator.ts', 'export function validateDbSchema(table: string, columns: any[]) { return true; }'],
        ['backup-restore.ts', 'export function createDatabaseSnapshot(): string { return "backup_20261118.dump"; }'],
        ['read-replica.ts', 'export class ReplicaRouter { getReadConnection() { return "replica-1"; } getWriteConnection() { return "primary"; } }'],
        ['index-optimizer.ts', 'export function analyzeMissingIndexes(slowQueries: string[]) { return ["CREATE INDEX idx_user_email"]; }'],
        ['sql-sanitizer.ts', 'export function sanitizeIdentifier(name: string): string { return name.replace(/[^a-zA-Z0-9_]/g, ""); }'],
        ['seed-data.ts', 'export async function seedDevelopmentDatabase() { return "Seeded 100 rows"; }'],
        ['soft-delete.ts', 'export function applySoftDeleteFilter(query: any) { return query + " AND deleted_at IS NULL"; }'],
        ['deadlock-detector.ts', 'export function retryOnDeadlock(fn: () => any, retries = 3) { return fn(); }'],
        ['audit-triggers.ts', 'export function createAuditTriggerSql(table: string): string { return "CREATE TRIGGER ..."; }'],
        ['timescale-db.ts', 'export function createHypertable(table: string, timeCol: string) { return true; }'],
        ['elastic-indexer.ts', 'export function syncToElasticsearch(docType: string, doc: any) {}'],
        ['db-metrics.ts', 'export function collectDbMetrics() { return { poolActive: 5, poolIdle: 15 }; }'],
        ['column-encryption.ts', 'export function encryptColumn(data: string, key: string): string { return "enc_" + data; }'],
        ['vector-store.ts', 'export class VectorStoreSqlite { searchNearest(vector: Float32Array, topK: number) { return []; } }'],
        ['partition-manager.ts', 'export function createMonthlyPartition(table: string, yearMonth: string) { return true; }'],
      ],
    },
    {
      name: 'orders',
      files: [
        ['order-pagination.ts', 'export interface PageResult<T> { items: T[]; nextCursor?: string; hasMore: boolean; } export function paginateOrders(cursor: string, limit = 20): PageResult<any> { return { items: [], hasMore: false }; }'],
        ['order-pipeline.ts', 'export class OrderPipeline { processOrder(orderId: string) { return { status: "PROCESSING" }; } }'],
        ['cart-manager.ts', 'export class CartManager { addItem(cartId: string, item: any) {} getCart(cartId: string) { return { items: [] }; } }'],
        ['checkout-session.ts', 'export function initCheckoutSession(userId: string, cartId: string) { return { sessionId: "chk_123" }; }'],
        ['shipping-calculator.ts', 'export function calculateShippingRate(weightKg: number, zipCode: string): number { return 15.0; }'],
        ['discount-engine.ts', 'export function calculateDiscounts(order: any, promoCode?: string) { return 0; }'],
        ['order-status.ts', 'export enum OrderStatus { PENDING, PAID, SHIPPED, DELIVERED, CANCELLED }'],
        ['tracking-number.ts', 'export function assignTrackingNumber(carrier: string, orderId: string): string { return "1Z9999999999999999"; }'],
        ['return-merchandise.ts', 'export function authorizeRma(orderId: string, reason: string): string { return "RMA-001"; }'],
        ['order-receipt.ts', 'export function generateReceiptPdf(orderId: string): string { return "receipt.pdf"; }'],
        ['order-cancellation.ts', 'export function cancelOrder(orderId: string, reason: string) { return true; }'],
        ['fulfillment-queue.ts', 'export class FulfillmentQueue { enqueue(order: any) {} }'],
        ['sales-tax.ts', 'export function calculateOrderSalesTax(subtotal: number, state: string): number { return subtotal * 0.08; }'],
        ['gift-card.ts', 'export function redeemGiftCard(code: string, balance: number): number { return balance; }'],
        ['order-export.ts', 'export function exportOrdersCsv(startDate: string, endDate: string): string { return "id,date,total"; }'],
        ['delivery-estimate.ts', 'export function estimateDeliveryDate(shippingMethod: string): string { return "2026-11-25"; }'],
        ['fraud-check.ts', 'export function evaluateFraudRisk(order: any): number { return 0.02; }'],
        ['invoice-pdf.ts', 'export function renderInvoicePdf(orderId: string) { return Buffer.from("pdf"); }'],
        ['order-events.ts', 'export function emitOrderEvent(name: string, payload: any) {}'],
        ['split-shipment.ts', 'export function splitOrderShipments(items: any[]): any[][] { return [items]; }'],
      ],
    },
    {
      name: 'inventory',
      files: [
        ['reorder-threshold.ts', 'export class ReorderThresholdManager { checkThreshold(sku: string, currentStock: number, threshold: number): boolean { return currentStock < threshold; } alertLowStock(sku: string) { return "Low stock alert triggered"; } }'],
        ['stock-checker.ts', 'export function getAvailableStock(sku: string): number { return 42; }'],
        ['warehouse-locator.ts', 'export function findNearestWarehouse(customerZip: string): string { return "WH-EAST-1"; }'],
        ['sku-generator.ts', 'export function generateSku(category: string, id: number): string { return `${category.toUpperCase()}-${id}`; }'],
        ['backorder-queue.ts', 'export class BackorderQueue { addBackorder(sku: string, qty: number) {} }'],
        ['supplier-catalog.ts', 'export function querySupplierPricing(supplierId: string, sku: string): number { return 12.5; }'],
        ['barcode-scanner.ts', 'export function decodeBarcode(code: string) { return { sku: "SKU-123", batch: "B-1" }; }'],
        ['batch-expiration.ts', 'export function checkBatchExpiration(batchDate: string): boolean { return false; }'],
        ['low-stock-alert.ts', 'export function sendLowStockEmail(sku: string, qty: number) { console.log("Low stock:", sku); }'],
        ['inventory-audit.ts', 'export function reconcileInventory(expected: number, counted: number): number { return counted - expected; }'],
        ['cycle-counter.ts', 'export function scheduleCycleCount(warehouseId: string) {}'],
        ['lot-tracking.ts', 'export function trackLotNumber(lotId: string) { return { status: "ACTIVE" }; }'],
        ['damaged-goods.ts', 'export function reportDamagedItem(sku: string, count: number, reason: string) {}'],
        ['reserve-stock.ts', 'export function reserveStockUnits(sku: string, qty: number): boolean { return true; }'],
        ['release-stock.ts', 'export function releaseReservedStock(sku: string, qty: number) {}'],
        ['warehouse-transfer.ts', 'export function transferStock(fromWh: string, toWh: string, sku: string, qty: number) {}'],
        ['stock-snapshot.ts', 'export function takeDailyStockSnapshot() { return { timestamp: Date.now() }; }'],
        ['supplier-lead-time.ts', 'export function getSupplierLeadTimeDays(supplierId: string): number { return 7; }'],
        ['abc-classification.ts', 'export function classifyAbcInventory(items: any[]) { return { A: [], B: [], C: [] }; }'],
        ['replenishment-plan.ts', 'export function buildReplenishmentOrder(neededSkus: any[]) { return { poNumber: "PO-99" }; }'],
      ],
    },
    {
      name: 'notifications',
      files: [
        ['sms-twilio.ts', 'export class TwilioSmsClient { sendSms(to: string, message: string) { return { sid: "SM_123", status: "sent" }; } handleDeliveryStatus(callbackPayload: any) { return callbackPayload.MessageStatus; } }'],
        ['email-sender.ts', 'export class EmailSender { send(to: string, subject: string, body: string) { return true; } }'],
        ['push-fcm.ts', 'export function sendFirebasePush(token: string, title: string, body: string) { return { multicastId: "1" }; }'],
        ['slack-webhook.ts', 'export function postSlackAlert(channel: string, text: string) { return true; }'],
        ['discord-bot.ts', 'export function sendDiscordMessage(channelId: string, content: string) { return true; }'],
        ['template-renderer.ts', 'export function renderTemplate(templateName: string, vars: any): string { return "Hello " + vars.name; }'],
        ['notification-preferences.ts', 'export class NotificationPreferences { isChannelEnabled(userId: string, channel: string): boolean { return true; } }'],
        ['digest-scheduler.ts', 'export function scheduleWeeklyDigest(userId: string) {}'],
        ['unsubscribe-link.ts', 'export function generateUnsubscribeToken(userId: string): string { return "unsub_token_123"; }'],
        ['delivery-status.ts', 'export enum DeliveryStatus { QUEUED, SENT, DELIVERED, BOUNCED, FAILED }'],
        ['in-app-inbox.ts', 'export class InAppInbox { getUnread(userId: string) { return []; } markRead(id: string) {} }'],
        ['rate-limit-notice.ts', 'export function shouldThrottleNotification(userId: string): boolean { return false; }'],
        ['sms-optout.ts', 'export function processSmsOptOut(phoneNumber: string) { return true; }'],
        ['webhook-subscriber.ts', 'export function notifyWebhooks(event: string, data: any) {}'],
        ['email-bounce.ts', 'export function handleEmailBounce(bounceData: any) {}'],
        ['badge-counter.ts', 'export function updateAppBadgeCount(deviceToken: string, count: number) {}'],
        ['pagerduty-alert.ts', 'export function triggerPagerDutyIncident(severity: string, summary: string) { return "INC-1"; }'],
        ['broadcast-announcement.ts', 'export function broadcastToAllUsers(title: string, message: string) {}'],
        ['sms-sender-id.ts', 'export function getSenderIdForCountry(country: string): string { return "NIRMAN"; }'],
        ['quiet-hours.ts', 'export function isQuietHours(timezone: string): boolean { return false; }'],
      ],
    },
    {
      name: 'analytics',
      files: [
        ['ab-test-variant.ts', 'export class AbTestManager { getVariant(userId: string, experimentKey: string): "control" | "treatment" { return userId.length % 2 === 0 ? "treatment" : "control"; } trackExperimentMetric(expKey: string, metric: string, value: number) {} }'],
        ['event-tracker.ts', 'export class EventTracker { track(name: string, props: any) {} }'],
        ['funnel-analysis.ts', 'export function computeFunnelConversion(steps: string[]): number[] { return [1.0, 0.6, 0.2]; }'],
        ['metric-counter.ts', 'export class MetricCounter { increment(metric: string, delta = 1) {} }'],
        ['dashboard-aggregator.ts', 'export function aggregateDailyMetrics(date: string) { return { dau: 1200, revenue: 5400 }; }'],
        ['retention-cohort.ts', 'export function calculateCohortRetention(cohortWeek: string): number[] { return [100, 45, 32, 28]; }'],
        ['export-csv.ts', 'export function exportMetricsToCsv(metrics: any[]): string { return "date,metric,value\\n"; }'],
        ['realtime-active.ts', 'export function getActiveUserCount(): number { return 187; }'],
        ['anomaly-detector.ts', 'export function detectTrafficAnomaly(currentRps: number, expectedRps: number): boolean { return currentRps > expectedRps * 2; }'],
        ['clickstream-stream.ts', 'export function ingestClickstream(eventPayload: any) {}'],
        ['pageview-counter.ts', 'export function recordPageview(url: string, referrer: string) {}'],
        ['heat-map.ts', 'export function recordClickCoordinates(x: number, y: number, page: string) {}'],
        ['churn-predictor.ts', 'export function predictChurnRisk(usageFrequency: number): number { return 0.15; }'],
        ['ltv-calculator.ts', 'export function calculateCustomerLtv(avgSpend: number, lifespanMonths: number): number { return avgSpend * lifespanMonths; }'],
        ['session-duration.ts', 'export function measureSessionDuration(start: number, end: number): number { return (end - start) / 1000; }'],
        ['query-performance.ts', 'export function logSlowQuery(sql: string, durationMs: number) {}'],
        ['attribution-model.ts', 'export function firstTouchAttribution(source: string, campaign: string) { return { source, campaign }; }'],
        ['dau-mau-ratio.ts', 'export function calculateStickiness(dau: number, mau: number): number { return dau / mau; }'],
        ['error-rate-monitor.ts', 'export function checkHttpErrorRate(errors: number, total: number): number { return errors / total; }'],
        ['feature-flag.ts', 'export function isFeatureFlagEnabled(flag: string, userId: string): boolean { return true; }'],
      ],
    },
    {
      name: 'users',
      files: [
        ['account-deletion.ts', 'export class AccountDeletionHandler { purgeUserData(userId: string): Promise<boolean> { return Promise.resolve(true); } anonymizeGdprRecord(userId: string) {} }'],
        ['user-profile.ts', 'export interface UserProfile { id: string; email: string; displayName: string; avatarUrl?: string; }'],
        ['user-repository.ts', 'export class UserRepository { findById(id: string): UserProfile | null { return null; } save(u: UserProfile) {} }'],
        ['avatar-uploader.ts', 'export function uploadAvatar(userId: string, imageBuffer: Buffer): string { return "https://s3/avatar.png"; }'],
        ['email-verifier.ts', 'export function sendVerificationEmail(userId: string, email: string) { return true; }'],
        ['password-reset.ts', 'export function initiatePasswordReset(email: string): string { return "reset_token_123"; }'],
        ['user-preferences.ts', 'export interface UserPreferences { theme: "light" | "dark"; language: string; }'],
        ['audit-history.ts', 'export function fetchUserAuditHistory(userId: string): any[] { return []; }'],
        ['team-invitation.ts', 'export function inviteMemberToTeam(teamId: string, email: string, role: string) { return "inv_123"; }'],
        ['organization-member.ts', 'export class OrganizationManager { addMember(orgId: string, userId: string) {} removeMember(orgId: string, userId: string) {} }'],
        ['user-status.ts', 'export enum UserStatus { ACTIVE, SUSPENDED, PENDING_VERIFICATION, DELETED }'],
        ['username-generator.ts', 'export function suggestAvailableUsernames(base: string): string[] { return [base + "1", base + "_x"]; }'],
        ['social-links.ts', 'export function updateSocialLinks(userId: string, links: Record<string, string>) {}'],
        ['block-user.ts', 'export function blockUser(blockerId: string, blockedId: string) { return true; }'],
        ['contact-import.ts', 'export function importGoogleContacts(authCode: string): string[] { return []; }'],
        ['phone-verification.ts', 'export function sendPhoneOtp(phone: string): string { return "otp_sent"; }'],
        ['badge-awarding.ts', 'export function awardBadge(userId: string, badgeName: string) {}'],
        ['activity-feed.ts', 'export function getUserActivityFeed(userId: string, limit = 10): any[] { return []; }'],
        ['follow-system.ts', 'export function followUser(followerId: string, targetId: string) { return true; }'],
        ['data-export-gdpr.ts', 'export function exportAllUserDataZip(userId: string): string { return "user_data.zip"; }'],
      ],
    },
    {
      name: 'api',
      files: [
        ['cors-middleware.ts', 'export function configureCors(allowedOrigins: string[]) { return (req: any, res: any, next: any) => { res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0] || "*"); next(); }; }'],
        ['rest-router.ts', 'export class RestRouter { get(path: string, handler: Function) {} post(path: string, handler: Function) {} }'],
        ['graphql-schema.ts', 'export const typeDefs = `type Query { health: String! users: [User!]! }`;'],
        ['request-logger.ts', 'export function requestLogger(req: any, res: any, next: any) { console.log(req.method, req.url); next(); }'],
        ['error-handler.ts', 'export function globalErrorHandler(err: Error, req: any, res: any, next: any) { res.statusCode = 500; res.end(err.message); }'],
        ['jwt-guard.ts', 'export function jwtAuthGuard(req: any, res: any, next: any) { if (!req.headers.authorization) throw new Error("Unauthorized"); next(); }'],
        ['api-versioning.ts', 'export function resolveApiVersion(url: string): string { return url.startsWith("/v2") ? "v2" : "v1"; }'],
        ['response-formatter.ts', 'export function formatApiResponse(data: any, meta?: any) { return { success: true, data, meta }; }'],
        ['compression-filter.ts', 'export function gzipCompress(body: string): Buffer { return Buffer.from(body); }'],
        ['swagger-docs.ts', 'export function generateOpenApiSpec(): object { return { openapi: "3.0.0", info: { title: "API" } }; }'],
        ['rate-limit-middleware.ts', 'export function apiRateLimiter(maxPerMin = 60) { return (req: any, res: any, next: any) => next(); }'],
        ['request-id.ts', 'export function attachRequestId(req: any, res: any, next: any) { req.id = "req_123"; next(); }'],
        ['health-controller.ts', 'export function getHealthStatus() { return { status: "UP", timestamp: Date.now() }; }'],
        ['pagination-helper.ts', 'export function parsePaginationParams(query: any) { return { page: parseInt(query.page || "1", 10), limit: 20 }; }'],
        ['header-validator.ts', 'export function validateRequiredHeaders(headers: any, required: string[]) { return true; }'],
        ['cache-control.ts', 'export function setCacheControl(res: any, maxAgeSeconds: number) { res.setHeader("Cache-Control", `max-age=${maxAgeSeconds}`); }'],
        ['webhook-receiver.ts', 'export class WebhookReceiver { registerHandler(event: string, fn: Function) {} }'],
        ['ip-geolocation.ts', 'export function getCountryFromIp(ip: string): string { return "US"; }'],
        ['body-parser.ts', 'export function parseJsonBody(rawText: string) { return JSON.parse(rawText); }'],
        ['rpc-dispatcher.ts', 'export class JsonRpcDispatcher { dispatch(method: string, params: any) { return { result: "ok" }; } }'],
      ],
    },
    {
      name: 'utils',
      files: [
        ['retry-backoff.ts', 'export class RetryBackoffStrategy { async executeWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 100): Promise<T> { return fn(); } }'],
        ['crypto-hash.ts', 'export function computeSha256(data: string): string { return "hash_sha256"; }'],
        ['string-formatter.ts', 'export function truncateString(s: string, maxLen: number): string { return s.slice(0, maxLen); }'],
        ['date-timezone.ts', 'export function formatToUtc(date: Date): string { return date.toISOString(); }'],
        ['env-parser.ts', 'export function parseRequiredEnv(name: string): string { return process.env[name] || "default"; }'],
        ['file-uploader.ts', 'export function uploadToS3(bucket: string, key: string, data: Buffer) { return `https://${bucket}/${key}`; }'],
        ['uuid-generator.ts', 'export function generateUuidV4(): string { return "123e4567-e89b-12d3-a456-426614174000"; }'],
        ['slugify-title.ts', 'export function slugify(text: string): string { return text.toLowerCase().replace(/\\s+/g, "-"); }'],
        ['deep-clone.ts', 'export function deepClone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }'],
        ['validation-rules.ts', 'export function isEmail(val: string): boolean { return val.includes("@"); }'],
        ['array-chunk.ts', 'export function chunkArray<T>(arr: T[], size: number): T[][] { return [arr]; }'],
        ['object-diff.ts', 'export function diffObjects(a: any, b: any) { return {}; }'],
        ['safe-json.ts', 'export function safeJsonParse<T>(raw: string, fallback: T): T { try { return JSON.parse(raw); } catch { return fallback; } }'],
        ['timer-promise.ts', 'export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }'],
        ['color-hex.ts', 'export function hexToRgb(hex: string) { return { r: 255, g: 255, b: 255 }; }'],
        ['base64-url.ts', 'export function toBase64Url(s: string): string { return Buffer.from(s).toString("base64url"); }'],
        ['file-extension.ts', 'export function getMimeType(filename: string): string { return "text/plain"; }'],
        ['memory-usage.ts', 'export function getMemoryStats() { return process.memoryUsage(); }'],
        ['math-stats.ts', 'export function median(numbers: number[]): number { return numbers[0] || 0; }'],
        ['concurrency-limit.ts', 'export class ConcurrencyLimiter { async run<T>(fn: () => Promise<T>): Promise<T> { return fn(); } }'],
      ],
    },
  ];

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-200-files-repo-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir });

    // Write all 200 domain files
    for (const domain of domains) {
      for (const [filename, content] of domain.files) {
        if (filename && content !== undefined) {
          await sandbox.writeFile(`src/${domain.name}/${filename}`, content);
        }
      }
    }

    // Write root files (total files: 205)
    await sandbox.writeFile('package.json', '{"name": "enterprise-monolith", "version": "1.0.0"}');
    await sandbox.writeFile('tsconfig.json', '{"compilerOptions": {"strict": true}}');
    await sandbox.writeFile('SPEC.md', '# Enterprise Spec\nArchitecture: Modular Monolith\nBuild: npm run build\nTest: npm test');
    await sandbox.writeFile('README.md', '# Enterprise Monolith\nLarge repository with 200+ source files across 10 functional domains.');

    repoIndex = new RepoIndex(tempDir, { dbPath: ':memory:' });
    const stats = await repoIndex.indexWorkspace(sandbox);
    expect(stats.indexedFilesCount).toBeGreaterThanOrEqual(200);
  });

  afterAll(async () => {
    repoIndex.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('indexes 200+ files and extracts symbols and summaries across all domains', () => {
    const fileTree = repoIndex.getFileTree();
    expect(fileTree.length).toBeGreaterThanOrEqual(200);

    const symbols = repoIndex.getSymbols();
    expect(symbols.length).toBeGreaterThanOrEqual(200);
  });

  // 10 distinct sample developer tasks spanning different domains
  const sampleTasks = [
    {
      taskId: 'task-1',
      title: 'JWT refresh token rotation',
      description: 'Implement JWT refresh token rotation logic in jwt-service.ts',
      expectedFile: 'src/auth/jwt-service.ts',
    },
    {
      taskId: 'task-2',
      title: 'Stripe webhook payment failure',
      description: 'Handle Stripe invoice payment failed webhook in payment-webhook.ts',
      expectedFile: 'src/billing/payment-webhook.ts',
    },
    {
      taskId: 'task-3',
      title: 'SQL injection protection in query builder',
      description: 'Fix SQL injection vulnerability in user query builder in query-builder.ts',
      expectedFile: 'src/database/query-builder.ts',
    },
    {
      taskId: 'task-4',
      title: 'Order pagination',
      description: 'Implement cursor-based pagination for getOrders in order-pagination.ts',
      expectedFile: 'src/orders/order-pagination.ts',
    },
    {
      taskId: 'task-5',
      title: 'Low stock reorder threshold alert',
      description: 'Add low stock alert notification when inventory drops below reorder-threshold.ts',
      expectedFile: 'src/inventory/reorder-threshold.ts',
    },
    {
      taskId: 'task-6',
      title: 'Twilio SMS delivery status',
      description: 'Add Twilio SMS delivery status callback handler in sms-twilio.ts',
      expectedFile: 'src/notifications/sms-twilio.ts',
    },
    {
      taskId: 'task-7',
      title: 'A/B test variant assignment',
      description: 'Implement A/B test variant assignment and metric tracking in ab-test-variant.ts',
      expectedFile: 'src/analytics/ab-test-variant.ts',
    },
    {
      taskId: 'task-8',
      title: 'GDPR user account deletion',
      description: 'Add account deletion and GDPR data purge handler in account-deletion.ts',
      expectedFile: 'src/users/account-deletion.ts',
    },
    {
      taskId: 'task-9',
      title: 'CORS allowed origins middleware',
      description: 'Configure CORS allowed origins and credentials middleware in cors-middleware.ts',
      expectedFile: 'src/api/cors-middleware.ts',
    },
    {
      taskId: 'task-10',
      title: 'Exponential backoff retry',
      description: 'Add exponential backoff with jitter retry strategy in retry-backoff.ts',
      expectedFile: 'src/utils/retry-backoff.ts',
    },
  ];

  it('retrieval finds the right files for all 10 sample tasks', async () => {
    for (const sample of sampleTasks) {
      const results = await repoIndex.retrieve(sample.description, {
        maxTokens: 2000,
        maxSnippets: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const matched = results.some((snippet) => snippet.filePath === sample.expectedFile);
      expect(
        matched,
        `Task "${sample.title}" failed to find expected file "${sample.expectedFile}". Got: ${results.map((r) => r.filePath).join(', ')}`,
      ).toBe(true);
    }
  });

  it('ContextManager assembles calls within configured budget and never exceeds it for all 10 tasks', async () => {
    const budget = 1500; // Small context budget
    const cm = new ContextManager({
      tokenBudget: budget,
      reserveCompletionTokens: 200,
      specMarkdown: '# Enterprise Spec\nArchitecture: Modular Monolith\nBuild: npm run build\nTest: npm test',
    });

    for (const sample of sampleTasks) {
      const snippets = await repoIndex.retrieve(sample.description, { maxTokens: 800 });

      const assembly = cm.assemble({
        task: {
          id: sample.taskId,
          title: sample.title,
          description: sample.description,
        },
        retrievedSnippets: snippets,
        conversationTurns: [
          { role: 'user', content: 'Step 1: check dependencies' },
          { role: 'assistant', content: 'Dependencies verified' },
        ],
      });

      // 1. Hard token budget is strictly enforced
      const actualTokens = estimateMessagesTokens(assembly.messages);
      expect(actualTokens).toBeLessThanOrEqual(budget);
      expect(assembly.stats.totalTokens).toBeLessThanOrEqual(budget);

      // 2. Contains system prompt and task instructions
      expect(assembly.messages.length).toBeGreaterThanOrEqual(2);
      expect(assembly.messages[0]?.role).toBe('system');
      expect(assembly.messages[0]?.content ?? '').toContain(sample.title);

      // 3. What was included and dropped is logged
      expect(assembly.stats.included.taskTokens).toBeGreaterThan(0);
      expect(assembly.stats.included.systemPromptTokens).toBeGreaterThan(0);
      expect(Array.isArray(assembly.stats.dropped)).toBe(true);
    }
  });
});
