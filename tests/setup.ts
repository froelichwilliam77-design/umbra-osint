import { setDetectedRamMbForTests } from "../server/power.ts";

/** Pin a 1 GB cgroup so lean defaults stay deterministic on fat developer / CI VMs. */
setDetectedRamMbForTests(1024);
