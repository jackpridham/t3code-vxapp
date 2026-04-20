import { useState, type ComponentType, type CSSProperties } from "react";
import { ArrowLeftIcon, ChevronDownIcon, HomeIcon, MenuIcon, Settings2Icon } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { cn } from "../../lib/utils";
import { SETTINGS_NAV_ITEMS, type SettingsSectionPath } from "../settings/SettingsSidebarNav";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { T3Wordmark } from "./SidebarShared";

type AppNavigationItem = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  match: (pathname: string) => boolean;
  to: "/" | SettingsSectionPath;
};

type AppNavigationGroup = {
  children: readonly AppNavigationItem[];
  icon: ComponentType<{ className?: string }>;
  label: string;
  match: (pathname: string) => boolean;
  to: SettingsSectionPath;
};

type AppNavigationNode = AppNavigationItem | AppNavigationGroup;

function hasNavigationChildren(item: AppNavigationNode): item is AppNavigationGroup {
  return "children" in item;
}

function isSettingsNavigationPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function isUtilityWindowPath(pathname: string): boolean {
  return (
    pathname.startsWith("/artifact") ||
    pathname.startsWith("/artifacts") ||
    pathname.startsWith("/changes/") ||
    pathname.startsWith("/sidebar")
  );
}

const SETTINGS_NAVIGATION_CHILDREN: readonly AppNavigationItem[] = SETTINGS_NAV_ITEMS.map(
  (item) => ({
    icon: item.icon,
    label: item.label,
    match: (pathname) => pathname === item.to,
    to: item.to,
  }),
);

const APP_NAVIGATION_ITEMS: readonly AppNavigationNode[] = [
  {
    icon: HomeIcon,
    label: "Chat",
    match: (pathname) => !isSettingsNavigationPath(pathname) && !isUtilityWindowPath(pathname),
    to: "/",
  },
  {
    children: SETTINGS_NAVIGATION_CHILDREN,
    icon: Settings2Icon,
    label: "Settings",
    match: isSettingsNavigationPath,
    to: "/settings/general",
  },
];

const NAVIGATION_MENU_STYLE = {
  "--sidebar-width": "100%",
} as CSSProperties;

export function SidebarNavigationMenuIcon(props: { className?: string }) {
  return <MenuIcon aria-hidden="true" className={cn("size-4", props.className)} />;
}

function SidebarNavigationMenu() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);

  const navigateTo = (to: AppNavigationNode["to"]) => {
    setOpen(false);
    void navigate({ to, replace: false });
  };

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetTrigger
              render={
                <Button
                  aria-label="Open navigation menu"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <SidebarNavigationMenuIcon />
            </SheetTrigger>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Navigation
        </TooltipPopup>
      </Tooltip>
      <SheetPopup
        className="w-[min(calc(100vw-3rem),16rem)] max-w-none bg-card p-0 text-foreground"
        showCloseButton={false}
        side="left"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Main application navigation.</SheetDescription>
        </SheetHeader>
        <SidebarProvider
          defaultOpen
          open
          className="h-full min-h-0 w-full"
          style={NAVIGATION_MENU_STYLE}
        >
          <Sidebar collapsible="none" className="h-full w-full border-r-0 bg-card text-foreground">
            <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
              <SidebarBrandMark />
            </SidebarHeader>
            <SidebarContent className="overflow-x-hidden">
              <SidebarGroup className="px-2 py-3">
                <SidebarMenu>
                  {APP_NAVIGATION_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.match(pathname);

                    if (hasNavigationChildren(item)) {
                      return (
                        <SidebarMenuItem key={item.to}>
                          <SidebarMenuButton
                            className={
                              isActive
                                ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                                : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                            }
                            isActive={isActive}
                            onClick={() => navigateTo(item.to)}
                            size="sm"
                          >
                            <Icon
                              className={
                                isActive
                                  ? "size-4 shrink-0 text-foreground"
                                  : "size-4 shrink-0 text-muted-foreground"
                              }
                            />
                            <span className="truncate">{item.label}</span>
                            <ChevronDownIcon
                              className={
                                isActive
                                  ? "ml-auto size-3.5 shrink-0 text-foreground/70"
                                  : "ml-auto size-3.5 shrink-0 text-muted-foreground/70"
                              }
                            />
                          </SidebarMenuButton>
                          <SidebarMenuSub className="mt-1">
                            {item.children.map((child) => {
                              const ChildIcon = child.icon;
                              const childIsActive = child.match(pathname);

                              return (
                                <SidebarMenuSubItem key={child.to}>
                                  <SidebarMenuSubButton
                                    className={
                                      childIsActive
                                        ? "w-full justify-start text-left text-[11px] text-foreground"
                                        : "w-full justify-start text-left text-[11px] text-muted-foreground hover:text-foreground/80"
                                    }
                                    isActive={childIsActive}
                                    onClick={() => navigateTo(child.to)}
                                    render={<button type="button" />}
                                    size="sm"
                                  >
                                    <ChildIcon
                                      className={
                                        childIsActive
                                          ? "size-3.5 shrink-0 text-foreground"
                                          : "size-3.5 shrink-0 text-muted-foreground"
                                      }
                                    />
                                    <span className="truncate">{child.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          className={
                            isActive
                              ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                              : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                          }
                          isActive={isActive}
                          onClick={() => navigateTo(item.to)}
                          size="sm"
                        >
                          <Icon
                            className={
                              isActive
                                ? "size-4 shrink-0 text-foreground"
                                : "size-4 shrink-0 text-muted-foreground"
                            }
                          />
                          <span className="truncate">{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
            <SidebarSeparator />
            <SidebarFooter className="p-2">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setOpen(false);
                      window.history.back();
                    }}
                    size="sm"
                  >
                    <ArrowLeftIcon className="size-4" />
                    <span>Back</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
        </SidebarProvider>
      </SheetPopup>
    </Sheet>
  );
}

function SidebarBrandMark() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1">
            <T3Wordmark />
            <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
              Code
            </span>
            <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              {APP_STAGE_LABEL}
            </span>
          </div>
        }
      />
      <TooltipPopup side="bottom" sideOffset={2}>
        Version {APP_VERSION}
      </TooltipPopup>
    </Tooltip>
  );
}

export function SidebarBrandHeader({
  isElectron,
  isStandaloneWindow,
}: {
  isElectron: boolean;
  isStandaloneWindow: boolean;
}) {
  return (
    <SidebarHeader
      className={
        isElectron
          ? "drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]"
          : "gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3"
      }
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        {!isStandaloneWindow ? <SidebarTrigger className="shrink-0 md:hidden" /> : null}
        <SidebarBrandMark />
        <SidebarNavigationMenu />
      </div>
    </SidebarHeader>
  );
}
