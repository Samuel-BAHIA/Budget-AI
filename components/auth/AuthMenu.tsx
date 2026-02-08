"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function AuthMenu() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="sidebarUserCard" style={{ opacity: 0.7 }}>
        <div className="sidebarUserAvatar" />
        <div className="sidebarUserName">Chargement…</div>
        <div className="sidebarUserEmail"> </div>
      </div>
    );
  }

  // Not authenticated: show a simple Google sign-in action.
  if (!session?.user) {
    return (
      <button type="button" className="sidebarAuthBtn" onClick={() => signIn("google")}> 
        <span className="sidebarAuthBtnIcon" aria-hidden="true">G</span>
        <span>Se connecter</span>
      </button>
    );
  }

  const name = session.user.name ?? (session.user.email ? session.user.email.split("@")[0] : "Utilisateur");
  const email = session.user.email ?? "";
  const image = (session.user as any).image as string | undefined;

  return (
    <div className="sidebarUserWrap">
      <div className="sidebarUserCard">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sidebarUserAvatarImg" src={image} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="sidebarUserAvatar" aria-hidden="true">
            {String(name).slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="sidebarUserName">{name}</div>
        {email ? <div className="sidebarUserEmail">{email}</div> : null}
      </div>

      <button type="button" className="sidebarSignOutBtn" onClick={() => signOut()}>
        Se déconnecter
      </button>
    </div>
  );
}
