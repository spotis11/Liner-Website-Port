import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-switch": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          selected?: boolean;
          disabled?: boolean;
        },
        HTMLElement
      >;
    }
  }
}
