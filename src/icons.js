/*
 * Inline SVG icons (white outline) for header/buttons
 */
const INLINE_ICONS = {
  anchor: {
    viewBox: '0 0 64 64',
    paths: [
      // anchor.svg paths (converted to outline via stroke)
      "m58.40131 21.836a1.56178 1.56178 0 0 0 .97992-2.6c-4.35992-4.79-7.62994-4.81-7.98993-4.81a.98543.98543 0 0 0 -.87.56c-1.37 2.81-.89 6.79-.48 8.92a1.55432 1.55432 0 0 0 2.69.71.18181.18181 0 0 1 .2-.05.202.202 0 0 1 .15.18 16.65361 16.65361 0 0 1 -1.31 8.37005 16.46146 16.46146 0 0 1 -4.74 6.13.97662.97662 0 0 1 -1.29-.05l-19.18-17.48a1.00772 1.00772 0 0 1 -.04-1.45l5.45995-5.5a3.52864 3.52864 0 0 0 -4.98-4.99994l-5.50997 5.54989a1.02686 1.02686 0 0 1 -1.42 0l-1.4-1.4a1.087 1.087 0 0 1 -.24-.99c2.0129-10.54477-13.58982-12.45157-14.22001-1.74986a7.24417 7.24417 0 0 0 8.8601 7.10979 1.05273 1.05273 0 0 1 1.00994.25011l1.42 1.42a1.00511 1.00511 0 0 1 -.01 1.41l-5.45 5.5a3.52894 3.52894 0 1 0 4.91012 5.06989l5.4299-5.47992a1.01212 1.01212 0 0 1 1.45.04l17.35 19.33a.99846.99846 0 0 1 .05 1.28c-2.94824 4.15449-9.45144 6.86251-14.38011 6.10973a.215.215 0 0 1 -.08983-.39978 1.5585 1.5585 0 0 0 .44-1.57 1.52566 1.52566 0 0 0 -1.19-1.09c-2.11-.41-6.07-.9-8.86.48a1.02071 1.02071 0 0 0 -.56.86c-.01.37.03 3.67 4.77 8.06a1.54742 1.54742 0 0 0 2.6-1.07.20537.20537 0 0 1 .28-.17c7.6292 3.14663 15.78333.1738 22.62006-3.06007a15.43718 15.43718 0 0 1 5.65-1.56987 3.40155 3.40155 0 0 0 3.14-3.2 15.2442 15.2442 0 0 1 .31-2.45 14.7527 14.7527 0 0 1 1.17-3.14c3.20523-6.88975 6.13491-15.10341 3.01985-22.77991-.02312-.1899-.00251-.23811.25001-.28011zm-49.28-8.61a3.04436 3.04436 0 0 1 4.30007-4.30993c2.74041 2.92182-1.39368 7.09766-4.3001 4.30993z",
      "m11.28657 9.46847a1.61513 1.61513 0 0 0 -1.12592 2.7386 1.57942 1.57942 0 0 0 2.22132 0 1.61523 1.61523 0 0 0 -1.0954-2.7386z"
    ]
  },
  edit: {
    viewBox: '0 0 24 24',
    paths: [
      // edit.svg paths (converted to outline via stroke)
      "m19 12c-.553 0-1 .448-1 1v8c0 .551-.448 1-1 1h-14c-.552 0-1-.449-1-1v-14c0-.551.448-1 1-1h8c.553 0 1-.448 1-1s-.447-1-1-1h-8c-1.654 0-3 1.346-3 3v14c0 1.654 1.346 3 3 3h14c1.654 0 3-1.346 3-3v-8c0-.553-.447-1-1-1z",
      "m9.376 11.089c-.07.07-.117.159-.137.255l-.707 3.536c-.033.164.019.333.137.452.095.095.223.146.354.146.032 0 .065-.003.098-.01l3.535-.707c.098-.02.187-.067.256-.137l7.912-7.912-3.535-3.535z",
      "m23.268.732c-.975-.975-2.561-.975-3.535 0l-1.384 1.384 3.535 3.535 1.384-1.384c.472-.471.732-1.099.732-1.767s-.26-1.296-.732-1.768z"
    ]
  }
};

function createInlineIcon(name, size = 18) {
  const def = INLINE_ICONS[name];
  if (!def) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", def.viewBox);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  def.paths.forEach(d => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  });
  return svg;
}

function createAnchorIcon(size = 18) {
  // Build provided anchor SVG and inherit currentColor (white in header)
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("version", "1.1");
  svg.setAttribute("id", "fi_877516");
  svg.setAttribute("xmlns", svgNS);
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svg.setAttribute("x", "0px");
  svg.setAttribute("y", "0px");
  svg.setAttribute("viewBox", "0 0 511.999 511.999");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  // Group 1: circle
  const g1 = document.createElementNS(svgNS, "g");
  const g1a = document.createElementNS(svgNS, "g");
  const circle = document.createElementNS(svgNS, "circle");
  circle.setAttribute("cx", "437.023");
  circle.setAttribute("cy", "74.972");
  circle.setAttribute("r", "15.001");
  circle.setAttribute("fill", "currentColor");
  g1a.appendChild(circle);
  g1.appendChild(g1a);
  svg.appendChild(g1);

  // Group 2: main path
  const g2 = document.createElementNS(svgNS, "g");
  const g2a = document.createElementNS(svgNS, "g");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M490.066,128.011c29.244-29.245,29.244-76.831,0-106.077c-29.245-29.245-76.832-29.246-106.077,0 c-16.744,16.744-24.491,40.481-21.215,63.646l-49.267,49.266l-31.822-31.823c-2.813-2.813-6.629-4.394-10.607-4.394 s-7.795,1.58-10.607,4.393l-42.431,42.43c-2.813,2.813-4.394,6.629-4.394,10.608s1.58,7.795,4.394,10.608l31.823,31.823 L123.325,325.028c-30.774-41.099-27.49-99.802,9.852-137.144l10.608-10.608l10.607,10.608c3.911,3.912,9.658,5.354,14.955,3.75 c5.296-1.603,9.278-5.991,10.363-11.416l21.215-106.077c0.983-4.919-0.556-10.003-4.103-13.549 c-3.546-3.546-8.627-5.086-13.549-4.102L77.198,77.706c-5.426,1.085-9.813,5.068-11.416,10.363 c-1.603,5.296-0.162,11.043,3.75,14.954l10.607,10.608l-31.823,31.823C-4.699,198.469-13.415,277.447,18.87,338.88 c16.624,31.634,25.052,62.238,25.052,90.961v23.234c0,8.285,6.717,15.002,15.001,15.002h23.235 c28.723,0,59.326,8.429,90.96,25.052c61.404,32.269,140.385,23.594,193.426-29.446l31.823-31.823l10.607,10.607 c3.911,3.912,9.658,5.354,14.955,3.75c5.296-1.603,9.278-5.991,10.363-11.416l21.215-106.077 c0.983-4.919-0.556-10.003-4.103-13.549c-3.546-3.546-8.633-5.086-13.549-4.102L331.78,332.288 c-5.426,1.085-9.813,5.068-11.416,10.363s-0.162,11.043,3.75,14.956l10.607,10.607l-10.607,10.607 c-37.343,37.344-96.046,40.625-137.145,9.852l126.536-126.537l31.823,31.823c5.858,5.858,15.357,5.858,21.215,0l42.431-42.431 c2.813-2.813,4.394-6.629,4.394-10.608c0-3.979-1.58-7.794-4.394-10.608l-31.823-31.823l49.267-49.266 C449.584,152.503,473.322,144.754,490.066,128.011z M410.881,122.334l-65.551,65.551c-2.813,2.813-4.394,6.629-4.394,10.608 c0,3.979,1.58,7.795,4.394,10.608l31.823,31.823l-21.216,21.215l-31.823-31.823c-5.858-5.859-15.357-5.858-21.215,0 L154.392,378.823c-2.813,2.813-4.394,6.629-4.394,10.608c0,3.979,1.58,7.795,4.394,10.608c52.644,52.642,138.298,52.641,190.938,0 l21.215-21.215c5.859-5.859,5.859-15.357,0-21.215l-1.395-1.395l56.526-11.305l-11.305,56.525l-1.395-1.394 c-2.813-2.813-6.629-4.393-10.607-4.393s-7.795,1.58-10.607,4.393l-42.431,42.431c-42.059,42.058-105.657,51.743-158.255,24.103 c-35.983-18.909-71.281-28.497-104.916-28.497h-8.234v-8.233c0-33.635-9.588-68.935-28.496-104.918 C17.788,272.327,27.474,208.73,69.532,166.672l42.431-42.431c5.859-5.859,5.859-15.357,0-21.215l-1.395-1.395l56.526-11.305 l-11.305,56.525l-1.395-1.394c-5.857-5.859-15.356-5.859-21.215,0l-21.216,21.215c-52.641,52.641-52.641,138.296,0,190.938 c2.813,2.813,6.629,4.394,10.607,4.394s7.795-1.581,10.607-4.393l148.508-148.507c2.813-2.813,4.394-6.629,4.394-10.608 c0-3.979-1.58-7.795-4.394-10.608l-31.823-31.823l21.216-21.215l31.822,31.823c2.813,2.813,6.629,4.394,10.607,4.394 s7.795-1.58,10.607-4.393l65.551-65.551c3.786-3.786,5.268-9.305,3.886-14.478c-4.139-15.5,0.326-32.164,11.652-43.491 c17.548-17.548,46.098-17.548,63.647,0c17.547,17.548,17.547,46.099,0,63.646c-11.328,11.327-27.993,15.792-43.491,11.653 C420.185,117.067,414.666,118.548,410.881,122.334z");
  path.setAttribute("fill", "currentColor");
  g2a.appendChild(path);
  g2.appendChild(g2a);
  svg.appendChild(g2);

  return svg;
}

function createNewConvoIcon(size = 18) {
  return createInlineIcon('edit', size);
}

function createMenuIcon(size = 22) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const paths = [
    "M3 6h18",
    "M3 12h18",
    "M3 18h18"
  ];
  paths.forEach(d => {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  });
  return svg;
}

export { createAnchorIcon, createNewConvoIcon, createMenuIcon };
