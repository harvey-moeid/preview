import './style.css';
document.getElementById('app').innerHTML='<span>LOCAL VITE FIXTURE</span><h1>Built for the browser.</h1><p>Vite assets, JavaScript and CSS from a real fixture build.</p><button id="counter">Clicked 0 times</button>';
let count=0;document.getElementById('counter').addEventListener('click',event=>{count++;event.target.textContent=`Clicked ${count} times`;});
