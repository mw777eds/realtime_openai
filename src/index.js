import { sampleData } from "./sampleData";
const btn = document.querySelector("button");

// the JS button
btn.onclick = function () {
  console.log("You ran some JavaScript");
  alert("You ran some JavaScript");
};

// this funciton is called by FileMaker.
window.loadWidget = function () {
  console.log("FileMaker called this function");
};
