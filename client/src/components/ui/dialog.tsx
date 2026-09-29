"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  mobileViewportAware?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, mobileViewportAware = false, ...props }, forwardedRef) => {
  const [contentNode, setContentNode] = React.useState<React.ElementRef<typeof DialogPrimitive.Content> | null>(null)
  const setContentRef = React.useCallback((node: React.ElementRef<typeof DialogPrimitive.Content> | null) => {
    setContentNode(node)
    if (typeof forwardedRef === "function") forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  React.useEffect(() => {
    if (!mobileViewportAware) return
    const content = contentNode
    if (!content) return

    let revealFrame = 0
    let revealTimer = 0
    let lastFocusedControl: HTMLElement | null = null
    const revealFocusedControl = () => {
      const reveal = () => {
        const focused = lastFocusedControl ?? document.activeElement
        if (focused instanceof HTMLElement && content.contains(focused)) {
          const contentRect = content.getBoundingClientRect()
          const focusedRect = focused.getBoundingClientRect()
          const visibleTop = contentRect.top + 16
          const visibleBottom = contentRect.bottom - 16
          if (focusedRect.bottom > visibleBottom) {
            content.scrollTop += focusedRect.bottom - visibleBottom
          } else if (focusedRect.top < visibleTop) {
            content.scrollTop -= visibleTop - focusedRect.top
          }
        }
      }
      window.cancelAnimationFrame(revealFrame)
      window.clearTimeout(revealTimer)
      revealFrame = window.requestAnimationFrame(reveal)
      revealTimer = window.setTimeout(reveal, 250)
    }
    const handleFocusIn = (event: FocusEvent) => {
      lastFocusedControl = event.target instanceof HTMLElement ? event.target : null
      revealFocusedControl()
    }
    const syncVisualViewport = () => {
      const viewport = window.visualViewport
      const height = Math.max(0, viewport?.height ?? window.innerHeight)
      const offsetTop = Math.max(0, viewport?.offsetTop ?? 0)
      content.style.setProperty("--dialog-visual-viewport-height", `${height}px`)
      content.style.setProperty("--dialog-visual-viewport-top", `${offsetTop}px`)
      revealFocusedControl()
    }

    const viewport = window.visualViewport
    syncVisualViewport()
    content.addEventListener("focusin", handleFocusIn)
    viewport?.addEventListener("resize", syncVisualViewport)
    viewport?.addEventListener("scroll", syncVisualViewport)
    window.addEventListener("resize", syncVisualViewport)
    window.addEventListener("orientationchange", syncVisualViewport)

    return () => {
      window.cancelAnimationFrame(revealFrame)
      window.clearTimeout(revealTimer)
      content.removeEventListener("focusin", handleFocusIn)
      viewport?.removeEventListener("resize", syncVisualViewport)
      viewport?.removeEventListener("scroll", syncVisualViewport)
      window.removeEventListener("resize", syncVisualViewport)
      window.removeEventListener("orientationchange", syncVisualViewport)
      content.style.removeProperty("--dialog-visual-viewport-height")
      content.style.removeProperty("--dialog-visual-viewport-top")
    }
  }, [contentNode, mobileViewportAware])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setContentRef}
        data-mobile-viewport-aware={mobileViewportAware ? "true" : undefined}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          mobileViewportAware && "top-[calc(var(--dialog-visual-viewport-top,0px)+max(0.5rem,env(safe-area-inset-top)))] max-h-[calc(var(--dialog-visual-viewport-height,100dvh)-max(1rem,env(safe-area-inset-top))-max(1rem,env(safe-area-inset-bottom)))] translate-y-0 overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))] touch-pan-y sm:top-[50%] sm:max-h-[90vh] sm:translate-y-[-50%] sm:pb-6",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
