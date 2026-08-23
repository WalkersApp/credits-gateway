import { useCallback, useEffect, useState } from "react";

import { api, type Account, type GatewayConfig } from "./api.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Fund } from "./pages/Fund.js";
import { Withdraw } from "./pages/Withdraw.js";
import { Activity } from "./pages/Activity.js";
import { Architecture } from "./pages/Architecture.js";
import { Evidence } from "./pages/Evidence.js";
import { Admin } from "./pages/Admin.js";
import { SignIn } from "./pages/SignIn.js";

const NAV = [
  ["/", "Dashboard"],
  ["/fund", "Fund credits"],
  ["/withdraw", "Withdraw"],
  ["/activity", "Activity"],
  ["/architecture", "Architecture"],
  ["/evidence", "TRL evidence"],
] as const;

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [account, setAccount] = useState<Account>({ signedIn: false });

  const refreshAccount = useCallback(async () => {
    setAccount(await api.account());
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig(null));
    refreshAccount().catch(() => undefined);
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [refreshAccount]);

  const go = (to: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    window.history.pushState({}, "", to);
    setPath(to);
  };

  if (!config) {
    return <div className="wrap"><p className="lede" style={{ marginTop: 40 }}>Loading gateway…</p></div>;
  }

  const needsSignIn = !account.signedIn && ["/", "/fund", "/withdraw", "/activity"].includes(path);

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">
            WFIT Stablecoin Gateway
            <small>{config.network} · reference implementation</small>
          </div>
          <nav>
            {NAV.map(([to, label]) => (
              <a key={to} href={to} onClick={go(to)} className={path === to ? "active" : ""}>{label}</a>
            ))}
            <a href="/admin" onClick={go("/admin")} className={path === "/admin" ? "active" : ""}>Admin</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        {needsSignIn ? (
          <SignIn onSignedIn={refreshAccount} />
        ) : path === "/fund" ? (
          <Fund config={config} onChanged={refreshAccount} />
        ) : path === "/withdraw" ? (
          <Withdraw config={config} account={account} onChanged={refreshAccount} />
        ) : path === "/activity" ? (
          <Activity config={config} />
        ) : path === "/architecture" ? (
          <Architecture config={config} />
        ) : path === "/evidence" ? (
          <Evidence config={config} />
        ) : path === "/admin" ? (
          <Admin config={config} account={account} onChanged={refreshAccount} />
        ) : (
          <Dashboard config={config} account={account} go={(to) => { window.history.pushState({}, "", to); setPath(to); }} onSignOut={async () => { await api.logout(); await refreshAccount(); }} />
        )}
      </main>
    </>
  );
}
