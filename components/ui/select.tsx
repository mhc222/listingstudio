"use client"

import * as React from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size" | "value" | "defaultValue"
> & {
  value?: string | number
  defaultValue?: string | number
}

type ParsedOption = {
  value: string
  label: React.ReactNode
  text: string
  disabled?: boolean
  description?: string
  group?: string
}

function optionText(node: React.ReactNode) {
  return React.Children.toArray(node)
    .map((part) => (typeof part === "string" || typeof part === "number" ? String(part) : ""))
    .join("")
    .trim()
}

function parseOptions(children: React.ReactNode, inheritedGroup?: string): ParsedOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return []

    if (child.type === React.Fragment) {
      return parseOptions((child.props as { children?: React.ReactNode }).children, inheritedGroup)
    }

    if (child.type === "optgroup") {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>
      return parseOptions(props.children, String(props.label ?? inheritedGroup ?? ""))
    }

    if (child.type !== "option") return []
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
      "data-description"?: string
    }
    const label = props.children ?? props.label ?? props.value
    return [{
      value: String(props.value ?? ""),
      label,
      text: optionText(label),
      disabled: props.disabled,
      description: props["data-description"],
      group: inheritedGroup,
    }]
  })
}

function Select({
  children,
  className,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  form,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...triggerProps
}: NativeSelectProps) {
  const options = parseOptions(children)
  const placeholder = options.find((option) => option.value === "")
  const selectable = options.filter((option) => option.value !== "")
  const groups = selectable.reduce<Array<{ label?: string; options: ParsedOption[] }>>((result, option) => {
    const last = result[result.length - 1]
    if (last && last.label === option.group) last.options.push(option)
    else result.push({ label: option.group, options: [option] })
    return result
  }, [])

  function handleValueChange(nextValue: string) {
    if (!onChange) return
    const target = { value: nextValue, name: name ?? "" } as HTMLSelectElement
    onChange({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>)
  }

  return (
    <SelectPrimitive.Root
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      onValueChange={handleValueChange}
      name={name}
      disabled={disabled}
      required={required}
      form={form}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-slot="select"
        className={cn(
          "ls-pressable flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[0.65rem] bg-card/88 px-3 py-1 text-left text-sm shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--border)_78%,transparent)] outline-none",
          "hover:bg-card hover:shadow-[inset_0_0_0_1px_var(--input)] focus-visible:ring-2 focus-visible:ring-ring/35 data-[placeholder]:text-muted-foreground disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...(triggerProps as React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>)}
      >
        <SelectPrimitive.Value placeholder={placeholder?.label ?? "Choose…"} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={10}
          className="z-[100] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-white/70 bg-popover/96 text-popover-foreground shadow-[var(--shadow-float)] backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center bg-popover text-muted-foreground">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {groups.map((group, groupIndex) => (
              <SelectPrimitive.Group key={`${group.label ?? "group"}-${groupIndex}`}>
                {group.label && (
                  <SelectPrimitive.Label className="px-2 pb-1 pt-2 text-[0.68rem] font-semibold tracking-[0.04em] text-muted-foreground">
                    {group.label}
                  </SelectPrimitive.Label>
                )}
                {group.options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    textValue={option.text}
                    className="relative flex min-h-10 cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <span className="absolute left-2.5 flex size-4 items-center justify-center text-primary">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="size-3.5" />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <span className="min-w-0">
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                      {option.description && (
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center bg-popover text-muted-foreground">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
