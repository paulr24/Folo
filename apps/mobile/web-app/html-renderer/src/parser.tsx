import { MemoedDangerousHTMLStyle } from "@follow/components/common/MemoedDangerousHTMLStyle.jsx"
import { Checkbox } from "@follow/components/ui/checkbox/index.jsx"
import type { SpotlightRule } from "@follow/shared/spotlight"
import { parseHtml as parseHtmlGeneral } from "@follow/utils/html"
import { clsx } from "clsx"
import type { Element, Parent } from "hast"
import type { Components } from "hast-util-to-jsx-runtime"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { createHeadingRenderer, MarkdownLink, MarkdownP } from "./components"
import { MarkdownImage } from "./components/image"
import { Math } from "./components/math"
import { ShikiHighLighter } from "./components/shiki"
import { applySpotlightToHtmlRendererTree } from "./spotlight"

const renderStyleTag: Components["style"] = ({ node, ...props }) => {
  if (typeof props.children === "string") {
    return createElement(MemoedDangerousHTMLStyle, null, props.children)
  }
  return null
}

const sanitizeResponsiveLayout = (tree: Parent) => {
  if (!Array.isArray(tree.children)) return

  for (const child of tree.children) {
    if (child.type !== "element") continue

    const element = child as Element
    const tagName = element.tagName

    if (["table", "td", "th", "div"].includes(tagName)) {
      if (element.properties) {
        // Strip fixed desktop width attributes (e.g. width="600") that cause horizontal overflow
        const widthProp = element.properties.width
        if (typeof widthProp === "number" && widthProp > 300) {
          delete element.properties.width
        } else if (
          typeof widthProp === "string" &&
          !widthProp.endsWith("%") &&
          parseInt(widthProp, 10) > 300
        ) {
          delete element.properties.width
        }

        // Clean fixed desktop width / min-width inline styles from newsletter templates
        const style = element.properties.style
        if (typeof style === "string") {
          const cleanedStyle = style
            .replace(/\bmin-width\s*:\s*[^;]+;?/gi, "")
            .replace(/\bwidth\s*:\s*(\d{3,}|[4-9]\d)px\s*;?/gi, "")
          element.properties.style = cleanedStyle
        }
      }
    }

    sanitizeResponsiveLayout(element)
  }
}

export const parseHtml = (
  content: string,
  options?: Partial<{
    renderInlineStyle: boolean
    noMedia?: boolean
    spotlightRules?: SpotlightRule[]
    coverImageUrl?: string
    baseUrl?: string
  }>,
) => {
  const spotlightRules = options?.spotlightRules ?? []

  return parseHtmlGeneral(content, {
    ...options,
    hastTransform: (tree) => {
      applySpotlightToHtmlRendererTree(tree, spotlightRules)
      sanitizeResponsiveLayout(tree)
    },
    components: {
      a: ({ node, ...props }) => {
        // Ignore link wrapper when child is an image to ensure image preview
        // works instead of navigating to the link URL when clicked
        //
        // Check if the link contains only an image as a child
        if (
          node.children &&
          node.children.length === 1 &&
          node.children[0].type === "element" &&
          node.children[0].tagName === "img"
        ) {
          // Return only the image element
          return props.children
        }
        return createElement(MarkdownLink, { ...props } as any)
      },

      h1: (props) => {
        return createHeadingRenderer(1)(props)
      },
      h2: (props) => {
        return createHeadingRenderer(2)(props)
      },
      h3: (props) => {
        return createHeadingRenderer(3)(props)
      },
      h4: (props) => {
        return createHeadingRenderer(4)(props)
      },
      h5: (props) => {
        return createHeadingRenderer(5)(props)
      },
      h6: (props) => {
        return createHeadingRenderer(6)(props)
      },
      style: renderStyleTag,
      img: ({ node, ...props }) => {
        return createElement(MarkdownImage, props as any)
      },

      p: ({ node, ...props }) => {
        if (node?.children && node.children.length !== 1) {
          for (const item of node.children) {
            item.type === "element" &&
              item.tagName === "img" &&
              ((item.properties as any).inline = true)
          }
        }
        return createElement(MarkdownP, props, props.children)
      },

      math: Math,
      hr: ({ node, ...props }) =>
        createElement("hr", {
          ...props,
          className: "scale-x-50",
        }),
      input: ({ node, ...props }) => {
        if (props.type === "checkbox") {
          return createElement(Checkbox, {
            ...props,
            disabled: false,
            className: "pointer-events-none mr-2",
          })
        }
        return createElement("input", props)
      },
      pre: ({ node, ...props }) => {
        if (!props.children) return null

        let language = ""

        let codeString = null as string | null
        if (props.className?.includes("language-")) {
          language = props.className.replace("language-", "")
        }

        if (typeof props.children !== "object") {
          codeString = props.children.toString()
        } else {
          const propsChildren = props.children
          const children = Array.isArray(propsChildren)
            ? propsChildren.find((i) => i.type === "code")
            : propsChildren

          // Don't process not code block
          if (!children) return createElement("pre", props, props.children)

          if (
            "type" in children &&
            children.type === "code" &&
            children.props.className?.includes("language-")
          ) {
            language = children.props.className.replace("language-", "")
          }
          const code = ("props" in children && children.props.children) || children
          if (!code) return null

          try {
            codeString = extractCodeFromHtml(renderToString(code))
          } catch (error) {
            console.error("Code Block Render Error", error)
            return createElement("pre", props, props.children)
          }
        }

        if (!codeString) return createElement("pre", props, props.children)

        return createElement(ShikiHighLighter, {
          code: codeString.trimEnd(),
          language: language.toLowerCase(),
        })
      },
      figure: ({ node, ...props }) =>
        createElement(
          "figure",
          {
            className: "mx-auto max-w-full",
            style: {
              marginLeft: "auto",
              marginRight: "auto",
              ...(props as any).style,
            },
          },
          props.children,
        ),
      table: ({ node, ...props }) =>
        createElement(
          "div",
          {
            className: "w-full overflow-x-auto",
          },

          createElement("table", {
            ...props,
            className: clsx(props.className, "w-full my-0 max-w-full"),
          }),
        ),
      td: ({ node, ...props }) =>
        createElement("td", {
          ...props,
          className: clsx(props.className, "max-w-full break-words"),
        }),
      th: ({ node, ...props }) =>
        createElement("th", {
          ...props,
          className: clsx(props.className, "max-w-full break-words"),
        }),
      video: ({ node, ...props }) =>
        createElement("video", {
          ...props,
          controls: true,
        }),
    },
  })
}
function extractCodeFromHtml(htmlString: string) {
  const tempDiv = document.createElement("div")
  tempDiv.innerHTML = htmlString

  const hasPre = tempDiv.querySelector("pre")
  if (!hasPre) {
    tempDiv.innerHTML = `<pre><code>${htmlString}</code></pre>`
  }

  // 1. line break via <div />
  const divElements = tempDiv.querySelectorAll("div")

  let code = ""

  if (divElements.length > 0) {
    divElements.forEach((div) => {
      if (!div.querySelector("div")) {
        code += `${div.textContent}\n`
      }
    })
    return code
  }

  // 2. line wrapper like <span><span>...</span></span>
  const spanElements = tempDiv.querySelectorAll("span > span")

  // 2.1 outside <span /> as a line break?

  let spanAsLineBreak = false

  if (tempDiv.children.length > 2) {
    for (const node of tempDiv.children) {
      const span = node as HTMLSpanElement
      // 2.2 If the span has only one child and it's a line break, then span can be as a line break
      spanAsLineBreak = span.children.length === 1 && span.childNodes.item(0).textContent === "\n"
      if (spanAsLineBreak) break
    }
  }

  if (!spanAsLineBreak) {
    const usingBr = tempDiv.querySelector("br")
    if (usingBr) {
      spanAsLineBreak = true
    }
  }

  if (spanElements.length > 0) {
    for (const node of tempDiv.children) {
      if (spanAsLineBreak) {
        code += `${node.textContent}`
      } else {
        code += `${node.textContent}\n`
      }
    }

    return code
  }

  return tempDiv.textContent
}
