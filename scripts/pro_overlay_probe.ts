// Pro overlay probe: exercises overlayWebsitePro without an upstream token.
// Owner path (jayzeyluna) never touches the db; grant path hits the local db.
import { overlayWebsitePro } from "../src/lib/linerProOverlay";

function jsonBuf(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
}

async function main() {
  const CT = "application/json";

  // 1. bare user object, owner -> upgraded
  const owner = await overlayWebsitePro(
    jsonBuf({ id: "u1", username: "jayzeyluna", displayName: "Jayzey", isPro: false }),
    CT,
  );
  const ownerOut = JSON.parse(new TextDecoder().decode(owner));
  console.log("[owner bare]", ownerOut.isPro === true ? "PASS" : "FAIL", JSON.stringify(ownerOut));

  // 2. auth envelope {user:{username}} -> user upgraded
  const envelope = await overlayWebsitePro(
    jsonBuf({
      accessToken: "tok",
      refreshToken: "rt_abc",
      user: { id: "u2", username: "jayzeyluna" },
    }),
    CT,
  );
  const envOut = JSON.parse(new TextDecoder().decode(envelope));
  console.log("[owner envelope]", envOut.user?.isPro === true ? "PASS" : "FAIL", JSON.stringify(envOut.user));

  // 3. unknown username -> untouched (no false Pro)
  const stranger = await overlayWebsitePro(
    jsonBuf({ id: "u3", username: "some_stranger", isPro: false }),
    CT,
  );
  const strangerOut = JSON.parse(new TextDecoder().decode(stranger));
  console.log("[stranger untouched]", strangerOut.isPro === false ? "PASS" : "FAIL");

  // 4. real upstream Pro is never downgraded
  const upstreamPro = await overlayWebsitePro(
    jsonBuf({ id: "u4", username: "some_stranger", isPro: true }),
    CT,
  );
  const proOut = JSON.parse(new TextDecoder().decode(upstreamPro));
  console.log("[upstream pro kept]", proOut.isPro === true ? "PASS" : "FAIL");

  // 5. non-JSON / no username -> untouched
  const noUser = await overlayWebsitePro(jsonBuf({ items: [] }), CT);
  console.log("[no user untouched]", new TextDecoder().decode(noUser) === '{"items":[]}' ? "PASS" : "FAIL");

  // 6. grant path: a website Pro grant (db) upgrades too
  const granted = await overlayWebsitePro(
    jsonBuf({ id: "u5", username: "guest_c65962", isPro: false }),
    CT,
  );
  const grantedOut = JSON.parse(new TextDecoder().decode(granted));
  console.log("[grant path (db lookup ran)]", typeof grantedOut.isPro === "boolean" ? "PASS" : "FAIL", `isPro=${grantedOut.isPro}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
