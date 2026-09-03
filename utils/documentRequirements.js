"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * The standard set of documents every employee is expected to provide,
 * defined once so employee creation, the onboarding checklist, and the
 * Employee Detail Documents tab all agree on what "required" means. Each
 * entry's `category` matches an EmployeeDocument.category value exactly —
 * this is a checklist view over the existing document store, not a second
 * document system.
 */
const REQUIRED_DOCUMENT_TYPES = [
    { category: 'Aadhaar Card', label: 'Government ID / Identity Proof', required: true },
    { category: 'Address Proof', label: 'Address Proof', required: true },
    { category: 'PAN Card', label: 'PAN / Tax Document', required: true },
    { category: 'Bank Account Details', label: 'Bank Account Details', required: true },
    { category: 'Cancelled Cheque', label: 'Cancelled Cheque / Bank Proof', required: false },
    { category: 'Educational Certificates', label: 'Educational Certificate', required: true },
    { category: 'Experience Certificate', label: 'Experience Letter', required: false },
    { category: 'Passport-size Photo', label: 'Passport-size Photograph', required: true },
    { category: 'Offer Letter', label: 'Employment Agreement', required: true },
];

/**
 * Builds the checklist for one employee from their existing documents. A
 * document's lifecycle status is reused rather than invented: PENDING reads
 * as "under review" here since there is no separate "just uploaded" state.
 */
function buildChecklist(employee, documents) {
    const byCategory = new Map();
    for (const doc of documents) {
        if (doc.isArchived) continue;
        const existing = byCategory.get(doc.category);
        // Prefer the most recently uploaded document per category.
        if (!existing || new Date(doc.createdAt) > new Date(existing.createdAt)) {
            byCategory.set(doc.category, doc);
        }
    }

    const items = REQUIRED_DOCUMENT_TYPES.map((def) => {
        const doc = byCategory.get(def.category);
        let status = 'MISSING';
        if (doc) {
            if (doc.status === 'VERIFIED') status = 'VERIFIED';
            else if (doc.status === 'REJECTED') status = 'REJECTED';
            else status = 'UNDER_REVIEW';
        }
        return {
            category: def.category,
            label: def.label,
            required: def.required,
            status,
            document: doc ? {
                _id: doc._id, name: doc.name, originalName: doc.originalName,
                fileSize: doc.fileSize, createdAt: doc.createdAt,
                verifiedBy: doc.verifiedBy, verifiedAt: doc.verifiedAt, rejectionReason: doc.rejectionReason,
            } : null,
        };
    });

    const requiredItems = items.filter((i) => i.required);
    const requiredMissing = requiredItems.filter((i) => i.status === 'MISSING').length;
    const requiredRejected = requiredItems.filter((i) => i.status === 'REJECTED').length;
    const requiredUnderReview = requiredItems.filter((i) => i.status === 'UNDER_REVIEW').length;
    const requiredVerified = requiredItems.filter((i) => i.status === 'VERIFIED').length;

    return {
        items,
        summary: {
            totalRequired: requiredItems.length,
            // Something exists for the slot, verified or not — a wider "in
            // progress" count distinct from `verified`.
            uploaded: requiredVerified + requiredRejected + requiredUnderReview,
            verified: requiredVerified,
            underReview: requiredUnderReview,
            rejected: requiredRejected,
            missing: requiredMissing,
            // Documentation only counts as complete once every required
            // document is VERIFIED — an upload alone (UNDER_REVIEW) or a
            // REJECTED document does not satisfy the requirement.
            isComplete: requiredItems.length > 0 && requiredVerified === requiredItems.length,
        },
    };
}

/** True if any required item was rejected — used to drive the HR list's "Rejected" filter. */
function hasRejectedRequiredDocument(checklist) {
    return checklist.items.some((i) => i.required && i.status === 'REJECTED');
}

module.exports = { REQUIRED_DOCUMENT_TYPES, buildChecklist, hasRejectedRequiredDocument };
