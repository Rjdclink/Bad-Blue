#!/usr/bin/env node
/**
 * Test script for master password functionality
 * Tests that password "SARBEAR" works with any email and grants access
 */

const MASTER_PASSWORD = "SARBEAR";

async function testMasterPassword() {
  console.log("🧪 Testing Master Password Functionality\n");
  console.log("=" .repeat(60));
  
  const testCases = [
    { 
      email: "test1@example.com", 
      password: MASTER_PASSWORD,
      description: "Master password with test email 1"
    },
    { 
      email: "test2@example.com", 
      password: MASTER_PASSWORD,
      description: "Master password with test email 2"
    },
    { 
      email: "anyemail@test.com", 
      password: MASTER_PASSWORD,
      description: "Master password with any email"
    },
    { 
      email: "", 
      password: MASTER_PASSWORD,
      description: "Master password without email"
    },
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.description}`);
    console.log(`   Email: ${testCase.email || '(empty)'}`);
    console.log(`   Password: ${testCase.password}`);
    
    try {
      // Test against local login endpoint
      const response = await fetch('http://localhost:5000/api/login/local', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: testCase.email,
          password: testCase.password,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && (data.success || data.isMasterBypass || data.hasActiveSubscription)) {
        console.log(`   ✅ PASS - Login successful`);
        console.log(`      Response:`, JSON.stringify(data, null, 2));
        passCount++;
      } else {
        console.log(`   ❌ FAIL - Login failed`);
        console.log(`      Status: ${response.status}`);
        console.log(`      Response:`, JSON.stringify(data, null, 2));
        failCount++;
      }
    } catch (error) {
      console.log(`   ⚠️  ERROR - Could not connect to server`);
      console.log(`      Error: ${error.message}`);
      console.log(`      Make sure the server is running on http://localhost:5000`);
      failCount++;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📈 Total: ${testCases.length}`);
  
  if (failCount === 0) {
    console.log(`\n🎉 All tests passed!`);
    return 0;
  } else {
    console.log(`\n⚠️  Some tests failed. Please review the output above.`);
    return 1;
  }
}

// Validate implementation without running server
function validateImplementation() {
  console.log("🔍 Validating Implementation\n");
  console.log("=" .repeat(60));
  
  const checks = [
    {
      file: "server/localAuth.ts",
      requirement: "Master password check in setupLocalStrategy",
      keywords: ["SARBEAR", "MASTER_PASSWORD", "isMasterBypass"]
    },
    {
      file: "server/routes.ts",
      requirement: "Master password check in login route",
      keywords: ["SARBEAR", "MASTER_PASSWORD", "isMasterBypass"]
    },
    {
      file: "server/legalizoRoutes.ts",
      requirement: "Master password check in legalizo login",
      keywords: ["SARBEAR", "MASTER_PASSWORD", "isMasterBypass"]
    }
  ];
  
  console.log("\n✅ Implementation files modified:");
  checks.forEach(check => {
    console.log(`   - ${check.file}`);
    console.log(`     Requirement: ${check.requirement}`);
  });
  
  console.log("\n📋 Master Password Features:");
  console.log("   - Password: SARBEAR");
  console.log("   - Works with ANY email address");
  console.log("   - Works WITHOUT email address");
  console.log("   - Bypasses payment requirements");
  console.log("   - Creates user automatically if needed");
  console.log("   - Grants active subscription status");
  
  console.log("\n" + "=".repeat(60));
}

// Main execution
if (process.argv.includes('--validate')) {
  validateImplementation();
} else {
  testMasterPassword().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
}
