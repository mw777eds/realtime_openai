// SVG path definitions
const SVG_PATHS = {
  sleep: [
    "m499.7259 344.908a258.5247 258.5247 0 0 1 -223.1346 140.6459c-146.7813 3.9346-267.6369-115.3557-265.5651-262.1752a257.959 257.959 0 0 1 92.3559-194.3524c8.23-6.9095 20.4231.5645 18.1 11.056a259.156 259.156 0 0 0 -6.0846 52.2262c-2.18 146.6924 118.5434 266.0979 265.2046 262.3678a257.1951 257.1951 0 0 0 104.35-24.9169c9.6416-4.5949 19.6467 5.6444 14.7738 15.1486z",
    "m361.9635 133.0592h62.7128a10.6661 10.6661 0 0 1 9.265 15.9505l-43.0489 75.4755a3.6193 3.6193 0 0 0 3.1439 5.4125h32.7876a13.0511 13.0511 0 0 1 13.0511 13.0511 13.0511 13.0511 0 0 1 -13.0511 13.0512h-65.6506a12.0167 12.0167 0 0 1 -10.4263-17.9912l42.4146-74.0188a3.2252 3.2252 0 0 0 -2.7982-4.8287h-28.4a13.0511 13.0511 0 0 1 -13.051-13.0513 13.0511 13.0511 0 0 1 13.0511-13.0508z",
    "m223.2989 38.2815h62.7128a10.6661 10.6661 0 0 1 9.2649 15.95l-43.0489 75.4755a3.6194 3.6194 0 0 0 3.1439 5.4125h32.7876a13.0511 13.0511 0 0 1 13.0508 13.0516 13.0512 13.0512 0 0 1 -13.0511 13.0512h-65.6503a12.0167 12.0167 0 0 1 -10.4262-17.9912l42.4146-74.0187a3.2252 3.2252 0 0 0 -2.7983-4.8286h-28.4a13.0512 13.0512 0 0 1 -13.0512-13.0511 13.0512 13.0512 0 0 1 13.0514-13.0512z"
  ],
  thought: [
    "M 33.615 189.725 C 36.306 198.953 40.041 207.851 44.764 216.199 L 31.308 233.171 C 26.914 238.719 27.408 246.628 32.351 251.626 L 55.53 274.805 C 60.528 279.803 68.437 280.242 73.985 275.848 L 90.847 262.501 C 99.525 267.499 108.752 271.399 118.364 274.145 L 120.891 295.84 C 121.715 302.871 127.647 308.144 134.677 308.144 L 167.467 308.144 C 174.498 308.144 180.43 302.87 181.253 295.84 L 183.67 274.914 C 193.996 272.222 203.883 268.213 213.165 262.995 L 229.478 275.902 C 235.025 280.296 242.934 279.802 247.933 274.859 L 271.111 251.68 C 276.109 246.682 276.549 238.773 272.155 233.226 L 259.467 217.133 C 264.74 208.014 268.859 198.293 271.605 188.132 L 291.159 185.88 C 298.19 185.056 303.462 179.124 303.462 172.094 L 303.462 139.304 C 303.462 132.273 298.189 126.341 291.159 125.517 L 271.88 123.265 C 269.243 113.214 265.289 103.602 260.236 94.595 L 272.1 79.6 C 276.494 74.053 276 66.143 271.057 61.145 L 247.933 38.022 C 242.935 33.023 235.026 32.584 229.478 36.978 L 214.923 48.512 C 205.476 42.965 195.369 38.736 184.769 35.88 L 182.572 17.04 C 181.748 10.01 175.816 4.737 168.786 4.737 L 135.996 4.737 C 128.965 4.737 123.033 10.01 122.209 17.04 L 120.012 35.88 C 109.137 38.791 98.756 43.185 89.09 48.952 L 73.985 36.978 C 68.438 32.584 60.529 33.078 55.53 38.022 L 32.352 61.2 C 27.354 66.198 26.914 74.107 31.308 79.655 L 43.941 95.638 C 38.888 104.756 35.043 114.477 32.517 124.584 L 12.304 126.891 C 5.274 127.714 0.001 133.646 0.001 140.677 L 0.001 173.467 C 0.001 180.497 5.274 186.429 12.304 187.253 L 33.615 189.725 Z M 152.418 101.021 C 182.297 101.021 206.629 125.353 206.629 155.232 C 206.629 185.112 182.297 209.444 152.418 209.444 C 122.539 209.444 98.207 185.112 98.207 155.232 C 98.207 125.353 122.538 101.021 152.418 101.021 Z",
    "M 476.585 197.799 L 459.284 183.189 C 453.957 178.686 446.102 178.905 441.049 183.684 L 431.492 192.637 C 423.419 188.737 414.851 185.991 406.007 184.398 L 403.317 171.216 C 401.944 164.405 395.627 159.681 388.706 160.231 L 366.132 162.153 C 359.211 162.757 353.773 168.415 353.554 175.39 L 353.115 188.792 C 344.436 191.922 336.252 196.207 328.782 201.589 L 317.359 194.01 C 311.535 190.165 303.791 191.263 299.288 196.591 L 284.678 214.002 C 280.174 219.33 280.393 227.184 285.171 232.238 L 295.168 242.892 C 291.707 250.692 289.236 258.876 287.808 267.279 L 273.528 270.19 C 266.717 271.563 261.993 277.88 262.543 284.801 L 264.465 307.375 C 265.069 314.296 270.727 319.733 277.702 319.953 L 293.136 320.447 C 295.938 327.807 299.618 334.783 304.066 341.318 L 295.443 354.336 C 291.599 360.158 292.697 367.902 298.024 372.406 L 315.326 387.016 C 320.654 391.52 328.508 391.3 333.561 386.522 L 344.876 375.921 C 352.291 379.381 360.09 381.963 368.109 383.501 L 371.24 398.99 C 372.613 405.8 378.93 410.524 385.85 409.975 L 408.424 408.052 C 415.345 407.448 420.783 401.791 421.002 394.815 L 421.497 379.656 C 429.735 376.745 437.534 372.79 444.729 367.902 L 457.198 376.141 C 463.02 379.986 470.764 378.887 475.268 373.559 L 489.878 356.258 C 494.382 350.93 494.162 343.076 489.384 338.023 L 479.332 327.368 C 483.013 319.569 485.705 311.33 487.241 302.871 L 500.973 300.07 C 507.783 298.696 512.507 292.38 511.958 285.459 L 510.035 262.885 C 509.431 255.964 503.774 250.527 496.798 250.307 L 483.012 249.867 C 480.156 241.848 476.311 234.269 471.533 227.238 L 479.057 215.924 C 483.012 210.103 481.914 202.303 476.585 197.799 Z M 391.507 328.301 C 367.121 330.389 345.589 312.208 343.557 287.822 C 341.47 263.435 359.651 241.904 384.037 239.872 C 408.423 237.784 429.955 255.965 431.987 280.351 C 434.074 304.739 415.893 326.269 391.507 328.301 Z",
    "M 112.597 389.049 C 105.676 389.763 100.349 395.584 100.294 402.56 L 100.129 416.456 C 100.019 423.432 105.182 429.364 112.103 430.243 L 122.319 431.561 C 124.021 437.768 126.438 443.7 129.569 449.302 L 122.978 457.431 C 118.584 462.868 118.913 470.668 123.802 475.666 L 133.524 485.608 C 138.412 490.606 146.211 491.155 151.759 486.871 L 159.942 480.555 C 165.709 483.96 171.806 486.652 178.177 488.519 L 179.276 499.064 C 179.99 505.985 185.812 511.313 192.787 511.368 L 206.684 511.532 C 213.659 511.642 219.591 506.479 220.47 499.559 L 221.733 489.562 C 228.654 487.859 235.245 485.278 241.506 481.873 L 249.196 488.079 C 254.633 492.473 262.433 492.144 267.432 487.256 L 277.373 477.534 C 282.371 472.646 282.92 464.846 278.637 459.299 L 272.759 451.664 C 276.384 445.622 279.186 439.195 281.108 432.44 L 290.226 431.506 C 297.146 430.792 302.473 424.97 302.529 417.994 L 302.693 404.098 C 302.803 397.123 297.64 391.19 290.72 390.312 L 281.821 389.158 C 280.119 382.457 277.593 375.976 274.297 369.934 L 279.845 363.124 C 284.239 357.686 283.909 349.887 279.021 344.888 L 269.3 334.947 C 264.411 329.948 256.611 329.399 251.064 333.684 L 244.417 338.792 C 238.156 335.002 231.455 332.091 224.425 330.114 L 223.546 321.49 C 222.832 314.569 217.01 309.242 210.034 309.187 L 196.138 309.022 C 189.163 308.912 183.231 314.075 182.351 320.996 L 181.253 329.565 C 174.003 331.432 167.028 334.288 160.547 338.023 L 153.681 332.42 C 148.243 328.026 140.444 328.357 135.445 333.244 L 125.449 343.022 C 120.451 347.909 119.902 355.709 124.186 361.256 L 130.063 368.836 C 126.657 374.878 123.966 381.304 122.208 388.06 L 112.597 389.049 Z M 202.29 373.34 C 222.228 373.559 238.21 389.983 237.991 409.92 C 237.771 429.858 221.348 445.841 201.41 445.622 C 181.473 445.402 165.49 428.979 165.709 409.041 C 165.929 389.104 182.352 373.121 202.29 373.34 Z"
  ],
  ear: [
    "M315.145,98.467c39.626,0,79.625,23.891,79.625,77.282c0,9.052,7.331,16.383,16.383,16.383 c9.052,0,16.383-7.331,16.383-16.383c0-72.241-56.533-110.048-112.382-110.048c-29.367,0-56.959,9.762-77.691,27.477 c-23.74,20.297-36.289,48.847-36.289,82.581v36.52c0,6.133,3.426,11.733,8.866,14.546c5.449,2.813,12.008,2.343,17.004-1.189 c10.401-7.357,31.701-18.185,44.889-15.744c3.807,0.701,6.381,2.405,8.609,5.715c3.435,5.094,4.313,9.745,2.84,15.105 c-5.449,19.773-39.795,42.315-60.172,51.874c-8.183,3.843-11.724,13.587-7.881,21.779c2.787,5.946,8.688,9.443,14.848,9.443 c2.316,0,4.677-0.488,6.905-1.553c6.789-3.168,66.606-32.136,77.859-72.8c4.038-14.599,1.526-29.189-7.251-42.2 c-7.153-10.579-17.519-17.377-29.979-19.622c-14.963-2.742-30.911,1.58-43.789,7.011v-8.893 C233.922,122.651,276.024,98.467,315.145,98.467z",
    "M316.201,0c-47.241,0-91.535,15.629-124.727,43.975c-37.754,32.278-57.713,77.85-57.713,131.774 c0,9.052,7.331,16.383,16.383,16.383c9.052,0,16.383-7.331,16.383-16.383c0-98.245,77.593-142.992,149.683-142.992 c39.014,0,75.126,12.656,101.662,35.633c29.633,25.666,45.306,62.79,45.306,107.368c0,75.543-32.597,100.464-67.103,126.857 c-28.364,21.699-60.527,46.291-70.12,98.387c-6.567,35.686-24.708,78.232-73.786,78.232c-42.599,0-70.138-29.544-70.138-75.268 c0-9.052-7.331-16.383-16.383-16.383s-16.383,7.331-16.383,16.383C149.265,467.572,191.58,512,252.169,512 c55.077,0,93.719-38.286,106.001-105.052c7.322-39.662,30.716-57.571,57.811-78.294c37.479-28.666,79.954-61.157,79.954-152.887 C495.935,54.998,402.766,0,316.201,0z",
    "M44.044,211.532c-6.381-6.408-16.756-6.408-23.163-0.027s-6.425,16.756-0.027,23.163 c15.034,15.078,23.323,35.091,23.323,56.364c0,21.246-8.289,41.241-23.323,56.32c-6.399,6.399-6.381,16.773,0.027,23.163 c3.204,3.186,7.384,4.784,11.573,4.784c4.207,0,8.396-1.606,11.591-4.81c21.22-21.255,32.89-49.477,32.89-79.457 C76.935,261.019,65.264,232.788,44.044,211.532z",
    "M64.856,157.254c-6.408,6.39-6.425,16.765-0.035,23.172c29.775,29.855,46.185,69.49,46.185,111.601 c0,42.076-16.41,81.702-46.185,111.566c-6.39,6.408-6.372,16.782,0.035,23.172c3.204,3.186,7.384,4.775,11.573,4.775 c4.207,0,8.404-1.606,11.599-4.792c35.943-36.059,55.734-83.894,55.734-134.712c0-50.844-19.791-98.697-55.734-134.747 C81.629,150.891,71.264,150.873,64.856,157.254z"
  ]
};

// Function to create an SVG element with paths
function createSVGIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 512 512");
  
  SVG_PATHS[type].forEach(pathData => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
  });
  
  return svg;
}

// Function to show a specific icon
function showIcon(type) {
  const overlay = document.getElementById('iconOverlay');
  // Clear existing content
  overlay.innerHTML = '';
  
  // Create and add new icon
  const icon = createSVGIcon(type);
  overlay.appendChild(icon);
  
  // Show overlay and animate icon
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    icon.style.opacity = '1';
    icon.style.display = 'block';
  });
}

export { showIcon };
