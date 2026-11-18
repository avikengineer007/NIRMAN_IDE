export interface LanguageRecipe {
  id: string;
  name: string;
  extensions: readonly string[];
  entryPointRule: string;
  userInputIdiom: string;
  runCommandExample: string;
  testCommandExample: string;
  calculatorExample: string;
}

export const LANGUAGE_RECIPES: readonly LanguageRecipe[] = [
  {
    id: 'python',
    name: 'Python',
    extensions: ['.py'],
    entryPointRule: 'Include an interactive `if __name__ == "__main__":` block at the bottom.',
    userInputIdiom: 'Use `input("...")` with `float(...)` / `int(...)` and a `while True` menu loop.',
    runCommandExample: 'python src/calculator.py',
    testCommandExample: 'python -m unittest discover -s src/tests -t .',
    calculatorExample: `def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def multiply(a, b):
    return a * b

def divide(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b

if __name__ == "__main__":
    print("=== Python Interactive Calculator ===")
    while True:
        op = input("\\nEnter operation (+, -, *, / or q to quit): ").strip().lower()
        if op in ("q", "quit", "exit"):
            print("Goodbye!")
            break
        try:
            a = float(input("Enter first number: ").strip())
            b = float(input("Enter second number: ").strip())
            if op in ("+", "add"):
                print("Result:", add(a, b))
            elif op in ("-", "subtract"):
                print("Result:", subtract(a, b))
            elif op in ("*", "multiply"):
                print("Result:", multiply(a, b))
            elif op in ("/", "divide"):
                print("Result:", divide(a, b))
            else:
                print("Invalid operation.")
        except Exception as err:
            print("Error:", err)`,
  },
  {
    id: 'javascript',
    name: 'JavaScript (Node.js)',
    extensions: ['.js', '.mjs'],
    entryPointRule: 'Include a runnable top-level `main()` or `require.main === module` CLI block.',
    userInputIdiom: 'Use `node:readline/promises` (`readline.createInterface`) with `await rl.question(...)`.',
    runCommandExample: 'node src/calculator.js',
    testCommandExample: 'node --check src/calculator.js',
    calculatorExample: `const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function multiply(a, b) { return a * b; }
function divide(a, b) {
  if (b === 0) throw new Error('Cannot divide by zero');
  return a / b;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const op = (await rl.question('Operation (+, -, *, /): ')).trim();
    const a = Number(await rl.question('First number: '));
    const b = Number(await rl.question('Second number: '));
    const ops = { '+': add, '-': subtract, '*': multiply, '/': divide };
    console.log('Result:', ops[op] ? ops[op](a, b) : 'Invalid operation');
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main().catch((err) => console.error('Error:', err.message));
}

module.exports = { add, subtract, multiply, divide };`,
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['.ts'],
    entryPointRule: 'Include a runnable `main()` CLI entry point and export pure helper functions.',
    userInputIdiom: 'Use `node:readline/promises` with typed arithmetic functions.',
    runCommandExample: 'npx tsx src/calculator.ts',
    testCommandExample: 'npx tsc --noEmit',
    calculatorExample: `import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const add = (a: number, b: number): number => a + b;
export const subtract = (a: number, b: number): number => a - b;
export const multiply = (a: number, b: number): number => a * b;
export const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error('Cannot divide by zero');
  return a / b;
};

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const op = (await rl.question('Operation (+, -, *, /): ')).trim();
    const a = Number(await rl.question('First number: '));
    const b = Number(await rl.question('Second number: '));
    const ops: Record<string, (x: number, y: number) => number> = {
      '+': add, '-': subtract, '*': multiply, '/': divide,
    };
    console.log('Result:', ops[op] ? ops[op](a, b) : 'Invalid operation');
  } finally {
    rl.close();
  }
}

main().catch((err) => console.error('Error:', err));`,
  },
  {
    id: 'c',
    name: 'C',
    extensions: ['.c'],
    entryPointRule: 'Include `int main(void)` returning `0`.',
    userInputIdiom: 'Use `printf(...)` and `scanf(...)` to read operator and numbers from `stdin`.',
    runCommandExample: 'gcc src/main.c -o app && ./app',
    testCommandExample: 'gcc -fsyntax-only src/main.c',
    calculatorExample: `#include <stdio.h>

int main(void) {
    char op;
    double a, b;
    printf("Enter operation (+, -, *, /): ");
    if (scanf(" %c", &op) != 1) return 1;
    printf("Enter two numbers: ");
    if (scanf("%lf %lf", &a, &b) != 2) return 1;

    switch (op) {
        case '+': printf("Result: %.2lf\\n", a + b); break;
        case '-': printf("Result: %.2lf\\n", a - b); break;
        case '*': printf("Result: %.2lf\\n", a * b); break;
        case '/':
            if (b == 0) printf("Error: Division by zero\\n");
            else printf("Result: %.2lf\\n", a / b);
            break;
        default: printf("Invalid operation\\n");
    }
    return 0;
}`,
  },
  {
    id: 'cpp',
    name: 'C++',
    extensions: ['.cpp', '.cc', '.cxx'],
    entryPointRule: 'Include `int main()` returning `0`.',
    userInputIdiom: 'Use `std::cout` and `std::cin` from `<iostream>`.',
    runCommandExample: 'g++ -std=c++17 src/main.cpp -o app && ./app',
    testCommandExample: 'g++ -std=c++17 -fsyntax-only src/main.cpp',
    calculatorExample: `#include <iostream>

int main() {
    char op;
    double a, b;
    std::cout << "Enter operation (+, -, *, /): ";
    std::cin >> op;
    std::cout << "Enter two numbers: ";
    std::cin >> a >> b;

    switch (op) {
        case '+': std::cout << "Result: " << (a + b) << "\\n"; break;
        case '-': std::cout << "Result: " << (a - b) << "\\n"; break;
        case '*': std::cout << "Result: " << (a * b) << "\\n"; break;
        case '/':
            if (b == 0) std::cout << "Error: Division by zero\\n";
            else std::cout << "Result: " << (a / b) << "\\n";
            break;
        default: std::cout << "Invalid operation\\n";
    }
    return 0;
}`,
  },
  {
    id: 'java',
    name: 'Java',
    extensions: ['.java'],
    entryPointRule: 'Include `public static void main(String[] args)` in the public class matching the filename.',
    userInputIdiom: 'Use `java.util.Scanner(System.in)` to read user inputs.',
    runCommandExample: 'javac Main.java && java Main',
    testCommandExample: 'javac Main.java',
    calculatorExample: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        try (Scanner sc = new Scanner(System.in)) {
            System.out.print("Enter operation (+, -, *, /): ");
            String op = sc.next().trim();
            System.out.print("Enter first number: ");
            double a = sc.nextDouble();
            System.out.print("Enter second number: ");
            double b = sc.nextDouble();

            switch (op) {
                case "+" -> System.out.println("Result: " + (a + b));
                case "-" -> System.out.println("Result: " + (a - b));
                case "*" -> System.out.println("Result: " + (a * b));
                case "/" -> System.out.println(b == 0 ? "Error: Division by zero" : "Result: " + (a / b));
                default -> System.out.println("Invalid operation");
            }
        }
    }
}`,
  },
  {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
    entryPointRule: 'Use `package main` with `func main()`.',
    userInputIdiom: 'Use `fmt.Print` and `fmt.Scan` or `bufio.NewScanner(os.Stdin)`.',
    runCommandExample: 'go run src/main.go',
    testCommandExample: 'go test ./...',
    calculatorExample: `package main

import "fmt"

func main() {
	var op string
	var a, b float64
	fmt.Print("Enter operation (+, -, *, /): ")
	fmt.Scan(&op)
	fmt.Print("Enter two numbers: ")
	fmt.Scan(&a, &b)

	switch op {
	case "+":
		fmt.Println("Result:", a+b)
	case "-":
		fmt.Println("Result:", a-b)
	case "*":
		fmt.Println("Result:", a*b)
	case "/":
		if b == 0 {
			fmt.Println("Error: Division by zero")
		} else {
			fmt.Println("Result:", a/b)
		}
	default:
		fmt.Println("Invalid operation")
	}
}`,
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs'],
    entryPointRule: 'Include `fn main()`.',
    userInputIdiom: 'Use `std::io::stdin().read_line(...)` with `.trim().parse::<f64>()`.',
    runCommandExample: 'rustc src/main.rs -o app && ./app',
    testCommandExample: 'rustc --emit=metadata src/main.rs',
    calculatorExample: `use std::io::{self, Write};

fn read_line(prompt: &str) -> String {
    print!("{}", prompt);
    io::stdout().flush().unwrap();
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    s.trim().to_string()
}

fn main() {
    let op = read_line("Enter operation (+, -, *, /): ");
    let a: f64 = read_line("First number: ").parse().expect("Invalid number");
    let b: f64 = read_line("Second number: ").parse().expect("Invalid number");
    match op.as_str() {
        "+" => println!("Result: {}", a + b),
        "-" => println!("Result: {}", a - b),
        "*" => println!("Result: {}", a * b),
        "/" if b != 0.0 => println!("Result: {}", a / b),
        "/" => println!("Error: Division by zero"),
        _ => println!("Invalid operation"),
    }
}`,
  },
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs'],
    entryPointRule: 'Include top-level statements or `static void Main(string[] args)`.',
    userInputIdiom: 'Use `Console.Write(...)` and `Console.ReadLine()`.',
    runCommandExample: 'dotnet run',
    testCommandExample: 'dotnet build',
    calculatorExample: `using System;

class Program {
    static void Main() {
        Console.Write("Enter operation (+, -, *, /): ");
        string op = Console.ReadLine()?.Trim() ?? "";
        Console.Write("First number: ");
        double a = double.Parse(Console.ReadLine() ?? "0");
        Console.Write("Second number: ");
        double b = double.Parse(Console.ReadLine() ?? "0");
        Console.WriteLine(op switch {
            "+" => $"Result: {a + b}",
            "-" => $"Result: {a - b}",
            "*" => $"Result: {a * b}",
            "/" when b != 0 => $"Result: {a / b}",
            "/" => "Error: Division by zero",
            _ => "Invalid operation"
        });
    }
}`,
  },
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb'],
    entryPointRule: 'Include a top-level or `if __FILE__ == $PROGRAM_NAME` interactive CLI block.',
    userInputIdiom: 'Use `print` and `gets.chomp`.',
    runCommandExample: 'ruby main.rb',
    testCommandExample: 'ruby -c main.rb',
    calculatorExample: `def add(a, b) = a + b
def subtract(a, b) = a - b
def multiply(a, b) = a * b
def divide(a, b) = b.zero? ? 'Error: Division by zero' : a / b

if __FILE__ == $PROGRAM_NAME
  print 'Operation (+, -, *, /): '
  op = gets.chomp
  print 'First number: '
  a = gets.to_f
  print 'Second number: '
  b = gets.to_f
  puts case op
       when '+' then "Result: #{add(a, b)}"
       when '-' then "Result: #{subtract(a, b)}"
       when '*' then "Result: #{multiply(a, b)}"
       when '/' then "Result: #{divide(a, b)}"
       else 'Invalid operation'
       end
end`,
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: ['.php'],
    entryPointRule: 'Include an interactive CLI entrypoint checking `PHP_SAPI === "cli"` or direct execution.',
    userInputIdiom: 'Use `readline("...")` or `fgets(STDIN)`.',
    runCommandExample: 'php main.php',
    testCommandExample: 'php -l main.php',
    calculatorExample: `<?php
$op = trim(readline("Operation (+, -, *, /): "));
$a = (float) readline("First number: ");
$b = (float) readline("Second number: ");
echo match ($op) {
    '+' => "Result: " . ($a + $b) . PHP_EOL,
    '-' => "Result: " . ($a - $b) . PHP_EOL,
    '*' => "Result: " . ($a * $b) . PHP_EOL,
    '/' => $b == 0 ? "Error: Division by zero\\n" : "Result: " . ($a / $b) . PHP_EOL,
    default => "Invalid operation\\n",
};`,
  },
];

/**
 * Returns targeted interactive entry-point and input/output guidance for the language
 * mentioned in the user's task, or general multi-language guidance if unspecified.
 */
export function getLanguageGuidanceForTask(task: string): string {
  const lower = task.toLowerCase();
  const matched = LANGUAGE_RECIPES.find((r) => {
    if (r.id === 'python') return /\b(python|py)\b/.test(lower);
    if (r.id === 'javascript') return /\b(javascript|node\.?js|js)\b/.test(lower);
    if (r.id === 'typescript') return /\b(typescript|ts)\b/.test(lower);
    if (r.id === 'cpp') return /\b(c\+\+|cpp)\b/.test(lower);
    if (r.id === 'csharp') return /\b(c#|csharp|dotnet)\b/.test(lower);
    if (r.id === 'c') return /(?:^|\s)c(?:\s|$|[.,!?])/.test(lower) || /\bc language\b/.test(lower);
    return new RegExp(`\\b${r.id}\\b`, 'i').test(lower);
  });

  if (matched) {
    const includeCalcRef = /\b(calc|calculator|arithmetic|input|menu|cli)\b/i.test(lower);
    return [
      `Language Guidance (${matched.name}):`,
      `- Entry point: ${matched.entryPointRule}`,
      `- User input: ${matched.userInputIdiom}`,
      `- Standard Run Command: ${matched.runCommandExample}`,
      `- Standard Test/Check Command: ${matched.testCommandExample}`,
      includeCalcRef
        ? `- Reference Interactive Pattern (${matched.name}):\n\`\`\`${matched.id}\n${matched.calculatorExample}\n\`\`\``
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'Multi-Language Entry-Point & User Input Rules:',
    ...LANGUAGE_RECIPES.slice(0, 7).map(
      (r) => `- ${r.name}: ${r.entryPointRule} Input: ${r.userInputIdiom} Run: \`${r.runCommandExample}\``,
    ),
  ].join('\n');
}
