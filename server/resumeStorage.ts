/**
 * Resume Storage Service
 * Handles S3 storage for resume files with version history
 */

import { storageDelete, storagePut, storageGet } from "./storage";
import { getDb } from "./db";
import { userResumes } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { RESUME_MIME_TYPES, validateUploadedFile } from "./uploadValidation";
import { logOperationalFailure } from "./operationalFailureLog";

// ============================================================================
// TYPES
// ============================================================================

export interface ResumeUploadResult {
  id: number;
  userId: number;
  fileName: string;
  fileUrl: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  version: number;
  isActive: boolean;
  uploadedAt: Date;
}

export interface ResumeVersion {
  id: number;
  version: number;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  isActive: boolean;
  uploadedAt: Date;
}

const PRIVATE_FILE_REFERENCE_PREFIX = "private://";

function privateFileReference(fileKey: string) {
  return `${PRIVATE_FILE_REFERENCE_PREFIX}${fileKey}`;
}

// ============================================================================
// MIME TYPE DETECTION
// ============================================================================

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/rtf": "rtf",
  "application/rtf": "rtf",
};

export function getMimeTypeFromExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc":
      return "application/msword";
    case "txt":
      return "text/plain";
    case "rtf":
      return "text/rtf";
    default:
      return "application/octet-stream";
  }
}

export function isValidResumeType(mimeType: string): boolean {
  return mimeType in SUPPORTED_MIME_TYPES;
}

export function getFileExtension(mimeType: string): string {
  return SUPPORTED_MIME_TYPES[mimeType] || "bin";
}

// ============================================================================
// RESUME UPLOAD
// ============================================================================

/**
 * Upload a resume file to S3 and create database record
 */
export async function uploadResume(
  userId: number,
  fileData: Buffer | Uint8Array,
  fileName: string,
  mimeType?: string
): Promise<ResumeUploadResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Determine mime type
  const detectedMimeType = mimeType || getMimeTypeFromExtension(fileName);
  
  if (!isValidResumeType(detectedMimeType)) {
    throw new Error(`Unsupported file type: ${detectedMimeType}. Supported types: PDF, DOCX, DOC, TXT, RTF`);
  }

  const validation = validateUploadedFile({
    data: fileData,
    fileName,
    mimeType: detectedMimeType,
    allowedMimeTypes: RESUME_MIME_TYPES,
  });
  // Get current version count for this user
  const existingResumes = await db
    .select({ version: userResumes.version })
    .from(userResumes)
    .where(eq(userResumes.userId, userId))
    .orderBy(desc(userResumes.version))
    .limit(1);

  const newVersion = (existingResumes[0]?.version || 0) + 1;

  // Generate unique file key
  const fileId = nanoid(12);
  const ext = getFileExtension(detectedMimeType);
  const sanitizedFileName = validation.fileName;
  const fileKey = `resumes/${userId}/${fileId}-v${newVersion}-${sanitizedFileName}`;

  // Upload to S3
  await storagePut(fileKey, fileData, detectedMimeType);
  const fileUrl = privateFileReference(fileKey);

  // Deactivate previous versions
  await db
    .update(userResumes)
    .set({ isActive: 0 })
    .where(eq(userResumes.userId, userId));

  // Create database record
  const result = await db.insert(userResumes).values({
    userId,
    fileName: sanitizedFileName,
    fileUrl,
    fileKey,
    fileSize: fileData.length,
    mimeType: detectedMimeType,
    version: newVersion,
    isActive: 1,
  });

  const insertId = result[0].insertId;

  return {
    id: insertId,
    userId,
    fileName: sanitizedFileName,
    fileUrl,
    fileKey,
    fileSize: fileData.length,
    mimeType: detectedMimeType,
    version: newVersion,
    isActive: true,
    uploadedAt: new Date(),
  };
}

// ============================================================================
// RESUME RETRIEVAL
// ============================================================================

/**
 * Get the active resume for a user
 */
export async function getActiveResume(userId: number): Promise<ResumeUploadResult | null> {
  const db = await getDb();
  if (!db) return null;

  const resumes = await db
    .select()
    .from(userResumes)
    .where(and(eq(userResumes.userId, userId), eq(userResumes.isActive, 1)))
    .limit(1);

  if (resumes.length === 0) return null;

  const resume = resumes[0];
  return {
    id: resume.id,
    userId: resume.userId,
    fileName: resume.fileName,
    fileUrl: resume.fileUrl,
    fileKey: resume.fileKey,
    fileSize: resume.fileSize,
    mimeType: resume.mimeType,
    version: resume.version,
    isActive: resume.isActive === 1,
    uploadedAt: resume.uploadedAt,
  };
}

/**
 * Get all resume versions for a user
 */
export async function getResumeVersions(userId: number): Promise<ResumeVersion[]> {
  const db = await getDb();
  if (!db) return [];

  const resumes = await db
    .select()
    .from(userResumes)
    .where(eq(userResumes.userId, userId))
    .orderBy(desc(userResumes.version));

  return resumes.map((r) => ({
    id: r.id,
    version: r.version,
    fileName: r.fileName,
    fileUrl: r.fileUrl,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    isActive: r.isActive === 1,
    uploadedAt: r.uploadedAt,
  }));
}

/**
 * Get a specific resume version
 */
export async function getResumeVersion(userId: number, version: number): Promise<ResumeUploadResult | null> {
  const db = await getDb();
  if (!db) return null;

  const resumes = await db
    .select()
    .from(userResumes)
    .where(and(eq(userResumes.userId, userId), eq(userResumes.version, version)))
    .limit(1);

  if (resumes.length === 0) return null;

  const resume = resumes[0];
  return {
    id: resume.id,
    userId: resume.userId,
    fileName: resume.fileName,
    fileUrl: resume.fileUrl,
    fileKey: resume.fileKey,
    fileSize: resume.fileSize,
    mimeType: resume.mimeType,
    version: resume.version,
    isActive: resume.isActive === 1,
    uploadedAt: resume.uploadedAt,
  };
}

/**
 * Set a specific version as active
 */
export async function setActiveVersion(userId: number, version: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Deactivate all versions
  await db
    .update(userResumes)
    .set({ isActive: 0 })
    .where(eq(userResumes.userId, userId));

  // Activate the specified version
  const result = await db
    .update(userResumes)
    .set({ isActive: 1 })
    .where(and(eq(userResumes.userId, userId), eq(userResumes.version, version)));

  return result[0].affectedRows > 0;
}

/**
 * Delete a specific resume version
 */
export async function deleteResumeVersion(userId: number, version: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Check if this is the active version
  const resume = await getResumeVersion(userId, version);
  if (!resume) return false;

  // Remove the private object first. Keep the ledger record if storage cleanup
  // fails so the file remains discoverable and can be retried by the user.
  await storageDelete(resume.fileKey);

  // Delete the version record only after physical storage cleanup succeeds.
  const result = await db
    .delete(userResumes)
    .where(and(eq(userResumes.userId, userId), eq(userResumes.version, version)));

  // If we deleted the active version, activate the most recent remaining version
  if (resume.isActive) {
    const remaining = await db
      .select()
      .from(userResumes)
      .where(eq(userResumes.userId, userId))
      .orderBy(desc(userResumes.version))
      .limit(1);

    if (remaining.length > 0) {
      await db
        .update(userResumes)
        .set({ isActive: 1 })
        .where(eq(userResumes.id, remaining[0].id));
    }
  }

  return result[0].affectedRows > 0;
}

/**
 * Get a fresh download URL for a resume
 */
export async function getResumeDownloadUrl(userId: number, version?: number): Promise<string | null> {
  const resume = version
    ? await getResumeVersion(userId, version)
    : await getActiveResume(userId);

  if (!resume) return null;

  try {
    const { url } = await storageGet(resume.fileKey);
    return url;
  } catch {
    logOperationalFailure("ResumeStorage", "Download URL retrieval");
    return null;
  }
}

// ============================================================================
// RESUME STATISTICS
// ============================================================================

/**
 * Get resume statistics for a user
 */
export async function getResumeStats(userId: number): Promise<{
  totalVersions: number;
  totalSize: number;
  activeVersion: number | null;
  lastUpdated: Date | null;
}> {
  const db = await getDb();
  if (!db) {
    return { totalVersions: 0, totalSize: 0, activeVersion: null, lastUpdated: null };
  }

  const resumes = await db
    .select()
    .from(userResumes)
    .where(eq(userResumes.userId, userId))
    .orderBy(desc(userResumes.version));

  if (resumes.length === 0) {
    return { totalVersions: 0, totalSize: 0, activeVersion: null, lastUpdated: null };
  }

  const totalSize = resumes.reduce((sum, r) => sum + r.fileSize, 0);
  const activeResume = resumes.find((r) => r.isActive === 1);

  return {
    totalVersions: resumes.length,
    totalSize,
    activeVersion: activeResume?.version || null,
    lastUpdated: resumes[0].uploadedAt,
  };
}
