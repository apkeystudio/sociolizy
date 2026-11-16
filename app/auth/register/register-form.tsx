"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Check,
  Globe,
  ChevronDown,
} from "lucide-react";
import { posthog } from "@/lib/posthog-client";
import AuthBrand from "@/app/auth/auth-brand";

interface ServerRegionOption {
  code: string;
  name: string;
  flag: string;
  serversCount?: number;
}

interface ServerNodeOption {
  id: string;
  group: string;
  serverIndex: number;
  name: string;
  flag: string;
}

export default function RegisterForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [serverArea, setServerArea] = useState("AUTO");
  const [regions, setRegions] = useState<ServerRegionOption[]>([
    { code: "AUTO", name: "⚡ Otomatis (Rotasi Beban Server Terbaik)", flag: "🌐" },
    { code: "SG", name: "Singapore", flag: "🇸🇬" },
    { code: "DC", name: "United States (Washington DC)", flag: "🇺🇸" },
  ]);
  const [servers, setServers] = useState<ServerNodeOption[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score;
  };

  const strengthScore = getPasswordStrength(password);

  const getStrengthLabel = () => {
    if (!password) return { label: "", color: "bg-slate-700", text: "text-slate-500" };
    if (strengthScore <= 2) return { label: "Weak", color: "bg-rose-500", text: "text-rose-400" };
    if (strengthScore <= 4) return { label: "Fair", color: "bg-amber-500", text: "text-amber-400" };
    return { label: "Strong", color: "bg-emerald-500", text: "text-emerald-400" };
  };

  const strength = getStrengthLabel();

  // Fetch dynamic active server regions and nodes from .env via /api/auth/register
  useEffect(() => {
    let isMounted = true;
    setIsLoadingRegions(true);
    fetch("/api/auth/register", {
      headers: { "ngrok-skip-browser-warning": "true" },
    })
      .then((res) => res.json())
      .then((res) => {
        if (isMounted && res.success && res.data) {
          if (res.data.regions?.length > 0) {
            setRegions(res.data.regions);
          }
          if (res.data.servers?.length > 0) {
            setServers(res.data.servers);
          }
          if (res.data.defaultRegion) {
            setServerArea(res.data.defaultRegion);
          }
        }
      })
      .catch((err) => {
        console.warn("Could not load dynamic server regions:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingRegions(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanEmail = email.trim();

    if (!cleanName || !cleanUsername || !cleanEmail || !password) {
      setErrorMessage("Please complete all required fields.");
      return;
    }

    // Name Validation: Cannot be email, only letters, numbers, spaces
    if (cleanName.includes("@") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanName)) {
      setErrorMessage("Full Name cannot be an email address.");
      return;
    }
    const nameRegex = /^[a-zA-Z0-9\s]{2,50}$/;
    if (!nameRegex.test(cleanName)) {
      setErrorMessage("Full Name can only contain letters, numbers, and spaces (no email or special symbols).");
      return;
    }

    // Username Validation: Cannot be email, only alphanumeric and underscore, no spaces
    if (cleanUsername.includes("@") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanUsername)) {
      setErrorMessage("Username cannot be an email address.");
      return;
    }
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(cleanUsername)) {
      setErrorMessage("Username can only contain letters, numbers, and underscores (3-30 characters, no email, spaces, or symbols).");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (!agreeTerms) {
      setErrorMessage("You must agree to the Terms of Service.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          name: cleanName,
          username: cleanUsername,
          email: cleanEmail,
          password,
          confirmPassword,
          server_area: serverArea,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setErrorMessage(result.message || "Failed to create account.");
        setIsLoading(false);
        return;
      }

      setSuccessMessage("Account created successfully! Redirecting to login...");

      try {
        posthog.capture("user_registered", {
          name: cleanName,
          username: cleanUsername,
          email: cleanEmail,
          server_area: serverArea,
        });
      } catch {}

      setTimeout(() => {
        router.push("/auth/login");
      }, 1200);
    } catch (err) {
      console.error(err);
      setErrorMessage("Network error. Please try again in a few moments.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md my-auto">
      <div className="auth-card-frame">
        <div className="auth-card relative rounded-3xl p-6 sm:p-7">
          <AuthBrand />
          {/* Card Header */}
          <div className="mb-4 text-center">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Create an Account
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Sign up to start placing orders and managing services
            </p>
          </div>

          {/* Feedback Alerts */}
          {errorMessage && (
            <div className="mb-3.5 flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs leading-relaxed animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="mb-3.5 flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successMessage}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Full Name Input */}
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Nama Lengkap / Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9\s]/g, ""))}
                  placeholder="Masukkan nama lengkap (hanya huruf & angka)"
                  autoComplete="name"
                  className="w-full pl-10 pr-4 py-2 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Hanya huruf, angka, dan spasi (tanpa email atau karakter khusus).
              </p>
            </div>

            {/* Username Input */}
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                  placeholder="Pilih username (contoh: johndoe)"
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Hanya huruf, angka, dan underscore (_) (tanpa email atau spasi).
              </p>
            </div>

            {/* Email Input */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-2 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Password
                </label>
                {password && (
                  <span className={`text-[10px] font-semibold ${strength.text}`}>
                    Strength: {strength.label}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  className="w-full pl-10 pr-10 py-2 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Password strength bar */}
              {password && (
                <div className="mt-1 flex gap-1 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${strength.color}`}
                    style={{ width: `${Math.min(100, Math.max(20, (strengthScore / 5) * 100))}%` }}
                  />
                </div>
              )}
            </div>

            {/* Confirm Password Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Confirm Password
                </label>
                {confirmPassword && (
                  <span className="text-[10px] flex items-center gap-1 font-medium">
                    {password === confirmPassword ? (
                      <span className="text-emerald-400 flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Matches
                      </span>
                    ) : (
                      <span className="text-rose-400">Does not match</span>
                    )}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="w-full pl-10 pr-10 py-2 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Server Region & Auto-Rolling Selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="serverArea"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Server Location / Cluster
                </label>
                <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Multi-Active Rolling
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Globe className="w-4 h-4" />
                </div>
                <select
                  id="serverArea"
                  value={serverArea}
                  onChange={(e) => setServerArea(e.target.value)}
                  disabled={isLoadingRegions}
                  className="w-full pl-10 pr-9 py-2 rounded-xl text-sm text-white bg-slate-900/70 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all cursor-pointer appearance-none"
                >
                  <option value="AUTO" className="bg-slate-900 text-white font-medium">
                    ⚡ Otomatis (Rotasi Beban Server Terbaik - Rekomendasi)
                  </option>
                  
                  {/* Region Groups */}
                  {regions.filter(r => r.code !== "AUTO").length > 0 && (
                    <optgroup label="Rotasi Berdasarkan Region" className="bg-slate-900 text-slate-300 font-semibold">
                      {regions
                        .filter(r => r.code !== "AUTO")
                        .map((reg) => (
                          <option key={`reg-${reg.code}`} value={reg.code} className="bg-white text-slate-900 py-1.5">
                            {reg.flag} {reg.name} (Auto-Rotate {reg.code})
                          </option>
                        ))}
                    </optgroup>
                  )}

                  {/* Individual Active Nodes */}
                  {servers.length > 0 && (
                    <optgroup label="Node Server Spesifik" className="bg-slate-900 text-slate-300 font-semibold">
                      {servers.map((srv) => (
                        <option key={`srv-${srv.id}`} value={srv.id} className="bg-white text-slate-900 py-1.5">
                          {srv.flag} {srv.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-500">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>

              {/* Dynamic Info Helper */}
              <div className="mt-1.5">
                {serverArea === "AUTO" ? (
                  <p className="text-[11px] text-emerald-400/90 leading-tight flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span><strong>Rotasi Otomatis Aktif</strong>: Akun baru otomatis didistribusikan bergantian ke server aktif dengan beban paling ringan.</span>
                  </p>
                ) : serverArea.includes("_") ? (
                  <p className="text-[11px] text-cyan-400/90 leading-tight flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    <span>Node spesifik <strong>{serverArea}</strong> dipilih untuk akun ini.</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-indigo-400/90 leading-tight flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>Akun akan dirotasi di antara semua node aktif di cluster region <strong>{serverArea}</strong>.</span>
                  </p>
                )}
              </div>
            </div>

            {/* Terms and Conditions Checkbox */}
            <div className="pt-0.5">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  required
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 bg-white text-emerald-600 focus:ring-emerald-500/30 focus:ring-offset-0"
                />
                <span className="text-[11px] text-slate-400 leading-tight">
                  I agree to the{" "}
                  <Link
                    href="/page/policy"
                    target="_blank"
                    className="text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                  >
                    Terms
                  </Link>{" "}
                  &amp;{" "}
                  <Link
                    href="/page/privacy"
                    target="_blank"
                    className="text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                  >
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600 hover:from-emerald-600 hover:to-green-500 active:scale-[0.99] transition-all shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/30 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Divider */}
          <div className="relative my-3.5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span className="px-2.5 bg-white text-slate-500 font-medium">
                Already have an account?
              </span>
            </div>
          </div>

          {/* Login Link Button */}
          <Link
            href="/auth/login"
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all text-center"
          >
            Sign In Instead
          </Link>

          {/* Footer security badge */}
          <div className="mt-3 text-center text-[10px] text-slate-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Secure registration &amp; instant account activation</span>
          </div>
        </div>
      </div>
    </div>
  );
}

