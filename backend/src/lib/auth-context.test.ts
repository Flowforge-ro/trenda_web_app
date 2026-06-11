import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSessionUser, requireRole, type AuthDeps } from "./auth-context.js";

function deps(user: unknown): AuthDeps {
  return {
    prisma: {
      user: { findUnique: async () => user },
    } as any,
  };
}

const sessionWith = (userId?: string) =>
  ({ get: (k: string) => (k === "userId" ? userId : undefined) }) as any;

test("loadSessionUser returns null when the session has no userId", async () => {
  const u = await loadSessionUser(sessionWith(undefined), deps(null));
  assert.equal(u, null);
});

test("loadSessionUser returns the user row for a valid session", async () => {
  const row = { id: "U1", email: "a@b.c", name: "A", role: "admin", orgId: "O1" };
  const u = await loadSessionUser(sessionWith("U1"), deps(row));
  assert.deepEqual(u, row);
});

test("loadSessionUser returns null when the user no longer exists", async () => {
  const u = await loadSessionUser(sessionWith("U1"), deps(null));
  assert.equal(u, null);
});

function fakeReply() {
  const calls: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      calls.status = code;
      return reply;
    },
    send(body: unknown) {
      calls.body = body;
      return reply;
    },
  };
  return { reply: reply as any, calls };
}

const request = (userId?: string) => ({ session: sessionWith(userId) });

const member = { id: "U1", email: "m@b.c", name: "M", role: "member", orgId: "O1" };
const admin = { id: "U2", email: "a@b.c", name: "A", role: "admin", orgId: "O1" };
const superadmin = { id: "U3", email: "s@b.c", name: "S", role: "superadmin", orgId: null };

test("requireRole sends 401 when there is no session user", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("member", request(undefined), reply, deps(null));
  assert.equal(u, null);
  assert.equal(calls.status, 401);
});

test("requireRole('member') returns any org-scoped user", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("member", request("U1"), reply, deps(member));
  assert.deepEqual(u, member);
  assert.equal(calls.status, undefined);
});

test("requireRole('member') sends 403 when the user has no org", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("member", request("U3"), reply, deps(superadmin));
  assert.equal(u, null);
  assert.equal(calls.status, 403);
});

test("requireRole('admin') returns an org admin", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("admin", request("U2"), reply, deps(admin));
  assert.deepEqual(u, admin);
  assert.equal(calls.status, undefined);
});

test("requireRole('admin') sends 403 for a plain member", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("admin", request("U1"), reply, deps(member));
  assert.equal(u, null);
  assert.equal(calls.status, 403);
});

test("requireRole('superadmin') returns a superadmin without requiring an org", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("superadmin", request("U3"), reply, deps(superadmin));
  assert.deepEqual(u, superadmin);
  assert.equal(calls.status, undefined);
});

test("requireRole('superadmin') sends 403 for an admin", async () => {
  const { reply, calls } = fakeReply();
  const u = await requireRole("superadmin", request("U2"), reply, deps(admin));
  assert.equal(u, null);
  assert.equal(calls.status, 403);
});
