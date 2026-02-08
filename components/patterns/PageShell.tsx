"use client";

import { ReactNode } from "react";

export function PageShell(props: {
  title: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`patternCardContent u-grid u-gap-14 ${props.className ?? ""}`.trim()}>
      <div className="pageHeaderRow u-flex-between-baseline u-gap-12">
        <h1 className="pageTitle">{props.title}</h1>
        {props.headerRight ? (
          <div className="pageHeaderRight muted u-nowrap">
            {props.headerRight}
          </div>
        ) : null}
      </div>

      {props.children}
    </div>
  );
}
