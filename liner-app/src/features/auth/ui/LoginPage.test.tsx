import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import LoginPage from "./LoginPage";

const mockNavigate = vi.fn();
const mockLogin = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, className, style, ...props }: any) => (
      <div className={className} style={style} {...props}>
        {children}
      </div>
    ),
    p: ({ children, className, style, ...props }: any) => (
      <p className={className} style={style} {...props}>
        {children}
      </p>
    ),
    form: ({ children, className, style, ...props }: any) => (
      <form className={className} style={style} {...props}>
        {children}
      </form>
    ),
  },
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      login: mockLogin,
      status: "anonymous",
      user: null,
    }),
  getAuthErrorCode: (err: any) =>
    err?.code ? err.code.toLowerCase() : "server_unavailable",
  authErrorMessage: (err: any) => err?.message || "An error occurred",
}));

vi.mock("@/languages", () => {
  const translations: Record<string, string> = {
    "login.auth_title_login": "Your music, your way",
    "login.auth_subtitle_login":
      "Sign in and pick up right where you left off.",
    "login.auth_title_register_disabled": "Sign-ups happen on original Liner",
    "login.auth_subtitle_register_disabled":
      "You can't create an account here — an account made on the original Liner site works.",
    "login.register_disabled_title": "You can't create an account here",
    "login.register_disabled_body":
      "Accounts are only created on the original Liner website (tryliner.fun). Make yours there first, then come back and sign in with the same email and password.",
    "login.register_disabled_hint":
      "Already made an account on tryliner.fun? Switch to Sign in and use it here.",
    "login.btn_create_on_original": "Create account on tryliner.fun",
    "login.btn_download_liner": "Download Liner",
    "login.btn_sign_in": "Sign in",
    "login.btn_signing_in": "Signing in…",
    "login.btn_create_account": "Create account",
    "login.label_email": "Email",
    "login.label_password": "Password",
    "login.placeholder_email": "you@example.com",
    "login.placeholder_password": "Your password",
    "login.show_password": "Show password",
    "login.hide_password": "Hide password",
    "login.legal": "By continuing, you agree to the",
    "login.legal_tos": "Terms of Service",
    "login.legal_and": "and",
    "login.legal_pp": "Privacy Policy",
    "login.errors.email_invalid": "Enter a valid email address.",
    "login.errors.password_min_8":
      "Password must contain at least 8 characters.",
    "login.errors.invalid_credentials": "Wrong email or password.",
    "login.errors.server_unavailable": "Server unavailable.",
    "login.errors.server_error": "Server error.",
  };

  return {
    LOCALE_OPTIONS: [
      { value: "en", label: "English" },
      { value: "ru", label: "Русский" },
      { value: "uk", label: "Українська" },
    ],
    useTranslation: () => ({
      locale: "en",
      setLocale: vi.fn(),
      t: (key: string, params?: Record<string, any>) => {
        let str = translations[key] || key;
        if (params) {
          Object.entries(params).forEach(([k, v]) => {
            str = str.replace(`{${k}}`, String(v));
          });
        }
        return str;
      },
    }),
  };
});

vi.mock("react-apple-emojis", () => ({
  Emoji: () => <span data-testid="emoji" />,
}));

describe("LoginPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  const setInputValue = async (selector: string, value: string) => {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const submitForm = async () => {
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  };

  it("renders Login mode with email and password by default", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    expect(container.querySelector("#auth-email")).not.toBeNull();
    expect(container.querySelector("#auth-password")).not.toBeNull();
    expect(container.querySelector("#auth-confirm")).toBeNull();
    expect(container.querySelector("#auth-username")).toBeNull();

    const buttons = Array.from(container.querySelectorAll("button"));
    const createAccBtn = buttons.find((b) =>
      b.textContent?.includes("Create account"),
    );
    expect(createAccBtn).toBeDefined();
  });

  it("skips native email validation and shows the styled error in Login mode", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.noValidate).toBe(true);

    await setInputValue("#auth-email", "dsf");
    await submitForm();

    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "Enter a valid email address",
    );
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("signs in with valid credentials and navigates home", async () => {
    mockLogin.mockResolvedValueOnce({});

    await act(async () => {
      root.render(<LoginPage />);
    });

    await setInputValue("#auth-email", "Alice@Example.com");
    await setInputValue("#auth-password", "password123");
    await submitForm();

    expect(mockLogin).toHaveBeenCalledWith("alice@example.com", "password123");
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows a server error under the form when sign-in fails", async () => {
    mockLogin.mockRejectedValueOnce({ code: "INVALID_CREDENTIALS" });

    await act(async () => {
      root.render(<LoginPage />);
    });

    await setInputValue("#auth-email", "alice@example.com");
    await setInputValue("#auth-password", "password123");
    await submitForm();

    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "Wrong email or password",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("Create account tab shows only the notice — no fields, Discord or guest", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const createAccBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Create account"),
    );
    await act(async () => {
      createAccBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // No sign-up form of any kind
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();

    // The notice is the only content
    expect(container.textContent).toContain(
      "You can't create an account here",
    );
    expect(container.textContent).toContain(
      "original Liner website (tryliner.fun)",
    );

    // Exactly the two action links, with the right targets
    const links = Array.from(container.querySelectorAll("a"));
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://tryliner.fun");
    expect(hrefs).toContain(
      "https://github.com/tryliner/desktop/releases/latest",
    );

    const createOriginal = links.find((a) =>
      a.textContent?.includes("Create account on tryliner.fun"),
    );
    const downloadLiner = links.find((a) =>
      a.textContent?.includes("Download Liner"),
    );
    expect(createOriginal).toBeDefined();
    expect(downloadLiner).toBeDefined();
    expect(createOriginal?.getAttribute("target")).toBe("_blank");
    expect(downloadLiner?.getAttribute("rel")).toContain("noreferrer");
  });

  it("has no Discord or guest sign-in anywhere on the login page", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    expect(container.textContent).not.toMatch(/discord/i);
    expect(container.textContent).not.toMatch(/guest/i);
  });
});
