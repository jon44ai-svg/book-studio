import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { getAuth } from "@workos/authkit-tanstack-react-start";

type EncryptedKey = {
	iv: string;
	tag: string;
	ciphertext: string;
};

const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaReady: Promise<void> | undefined;

function database() {
	if (!sql) throw new Error("DATABASE_URL is not configured on the server");
	return sql;
}

function encryptionKey(): Buffer {
	const configured = process.env.GROQ_CREDENTIAL_ENCRYPTION_KEY;
	if (!configured) {
		throw new Error(
			"GROQ_CREDENTIAL_ENCRYPTION_KEY is not configured on the server",
		);
	}

	const hex = /^[0-9a-f]{64}$/i.test(configured)
		? Buffer.from(configured, "hex")
		: Buffer.from(configured, "base64");
	return hex.length === 32
		? hex
		: createHash("sha256").update(configured).digest();
}

async function ensureSchema(): Promise<void> {
	schemaReady ??= database()`
		CREATE TABLE IF NOT EXISTS user_groq_credentials (
			user_id TEXT PRIMARY KEY,
			iv TEXT NOT NULL,
			auth_tag TEXT NOT NULL,
			ciphertext TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`.then(() => undefined);
	await schemaReady;
}

async function currentUserId(): Promise<string> {
	const auth = await getAuth();
	const userId = auth.user?.id;
	if (!userId) throw new Error("Sign in before configuring a Groq key");
	return userId;
}

function encrypt(apiKey: string): EncryptedKey {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(apiKey, "utf8"),
		cipher.final(),
	]);
	return {
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};
}

function decrypt(value: EncryptedKey): string {
	const decipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(),
		Buffer.from(value.iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(value.tag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(value.ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}

export async function getUserGroqCredential(): Promise<string | null> {
	const userId = await currentUserId();
	await ensureSchema();
	const rows = await database()`
		SELECT iv, auth_tag AS "authTag", ciphertext
		FROM user_groq_credentials
		WHERE user_id = ${userId}
	`;
	const row = rows[0] as
		| { iv: string; authTag: string; ciphertext: string }
		| undefined;
	return row
		? decrypt({ iv: row.iv, tag: row.authTag, ciphertext: row.ciphertext })
		: null;
}

export async function saveUserGroqCredential(apiKey: string): Promise<void> {
	const trimmed = apiKey.trim();
	if (!trimmed || trimmed.length > 500) {
		throw new Error("Enter a valid Groq API key");
	}
	const userId = await currentUserId();
	await ensureSchema();
	const value = encrypt(trimmed);
	await database()`
		INSERT INTO user_groq_credentials (user_id, iv, auth_tag, ciphertext)
		VALUES (${userId}, ${value.iv}, ${value.tag}, ${value.ciphertext})
		ON CONFLICT (user_id) DO UPDATE SET
			iv = EXCLUDED.iv,
			auth_tag = EXCLUDED.auth_tag,
			ciphertext = EXCLUDED.ciphertext,
			updated_at = NOW()
	`;
}

export async function deleteUserGroqCredential(): Promise<void> {
	const userId = await currentUserId();
	await ensureSchema();
	await database()`DELETE FROM user_groq_credentials WHERE user_id = ${userId}`;
}

export async function getEffectiveGroqCredential(): Promise<string | null> {
	if (sql && process.env.GROQ_CREDENTIAL_ENCRYPTION_KEY) {
		const personal = await getUserGroqCredential().catch(() => null);
		if (personal) return personal;
	}
	return process.env.GROQ_API_KEY || null;
}

export function hasCredentialStorage(): boolean {
	return Boolean(sql && process.env.GROQ_CREDENTIAL_ENCRYPTION_KEY);
}
