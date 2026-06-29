import { test } from "node:test";
import assert from "node:assert/strict";
import { getEnabledFeatures, requireFeature, type FeatureDeps } from "./feature-access.js";

function depsWith(enabledKeys: string[]): FeatureDeps {
  return {
    prisma: {
      organizationFeature: {
        findMany: async ({ where }: any) => {
          assert.equal(where.enabled, true);
          return enabledKeys.map((featureKey) => ({ featureKey }));
        },
      },
      user: {
        findUnique: async () => ({
          id: "U1",
          email: "m@x",
          name: null,
          role: "member",
          orgId: "O1",
          sessionVersion: 0,
          org: { suspendedAt: null },
        }),
      },
    } as any,
  };
}

const session = { get: (k: string) => (k === "userId" ? "U1" : k === "sv" ? 0 : undefined) } as any;

function fakeReply() {
  const r: any = { statusCode: 0, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  return r;
}

test("getEnabledFeatures returns enabled keys", async () => {
  const r = await getEnabledFeatures("O1", depsWith(["vendor_communication"]));
  assert.deepEqual(r, ["vendor_communication"]);
});

test("getEnabledFeatures drops keys not in the code registry", async () => {
  const r = await getEnabledFeatures("O1", depsWith(["vendor_communication", "ghost_feature"]));
  assert.deepEqual(r, ["vendor_communication"]);
});

test("requireFeature returns the user when the feature is enabled", async () => {
  const reply = fakeReply();
  const user = await requireFeature("vendor_communication", { session }, reply, depsWith(["vendor_communication"]));
  assert.equal(user?.id, "U1");
  assert.equal(reply.statusCode, 0);
});

test("requireFeature sends 403 when the feature is not enabled", async () => {
  const reply = fakeReply();
  const user = await requireFeature("customer_communication", { session }, reply, depsWith(["vendor_communication"]));
  assert.equal(user, null);
  assert.equal(reply.statusCode, 403);
});
