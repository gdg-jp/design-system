import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../Sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "../Sidebar";

export function AppShell({
  navigation,
  header,
  footer,
  mainClassName,
  children,
  brand,
  navigationLabel = "ナビゲーション",
  navigationDescription = "移動先を選択してください。",
  closeNavigationLabel = "閉じる",
  skipLinkLabel = "本文へ移動",
  collapsible = "icon",
  defaultSidebarOpen = true,
  sidebarOpen,
  onSidebarOpenChange,
}: {
  navigation: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  mainClassName?: string;
  children: ReactNode;
  brand: ReactNode;
  navigationLabel?: string;
  navigationDescription?: ReactNode;
  closeNavigationLabel?: ReactNode;
  skipLinkLabel?: ReactNode;
  collapsible?: "offcanvas" | "icon" | "none";
  defaultSidebarOpen?: boolean;
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <SidebarProvider
      className="gdg-shell"
      defaultOpen={defaultSidebarOpen}
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
    >
      <a className="gdg-skip-link" href="#gdg-main">
        {skipLinkLabel}
      </a>
      <Sidebar aria-label={navigationLabel} collapsible={collapsible}>
        <SidebarHeader>
          <div className="gdg-sidebar-title">{brand}</div>
          {collapsible !== "none" && <SidebarTrigger />}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>{navigation}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {footer && <SidebarFooter>{footer}</SidebarFooter>}
      </Sidebar>
      <div className="gdg-shell-body">
        <header className={`gdg-shell-header${header ? "" : " gdg-shell-header-mobile"}`}>
          <div className="gdg-mobile-only">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <IconButton variant="ghost" aria-label={navigationLabel}>
                  <Menu size={20} />
                </IconButton>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>{navigationLabel}</SheetTitle>
                <SheetDescription>{navigationDescription}</SheetDescription>
                <div
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) setMobileNavOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLElement).closest("a"))
                      setMobileNavOpen(false);
                  }}
                >
                  {navigation}
                </div>
                {footer}
                <SheetClose asChild>
                  <Button variant="outline">{closeNavigationLabel}</Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          </div>
          {header}
        </header>
        <SidebarInset id="gdg-main" tabIndex={-1} className={`gdg-main ${mainClassName ?? ""}`}>
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
