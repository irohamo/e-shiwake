/** Single personal Agent credential; cap read/write load without trusting proxy IP headers. */
export class AgentRateLimit {
	private times: number[] = [];
	allow(now = Date.now()) {
		this.times = this.times.filter((t) => t > now - 60000);
		if (this.times.length >= 120) return false;
		this.times.push(now);
		return true;
	}
}
