import { useState } from "react";
import { Main } from "../components/page/Main";

function App() {
	const [count, setCount] = useState(0);
	
	return (
		<div className="h-screen">
			
				<div className="flex flex-col h-full">
					<Main />
			
			</div>
		</div>
	);
}

export default App;
